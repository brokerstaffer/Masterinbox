// Outbound n8n notification for human-initiated Introductions.
//
// Fires a POST to N8N_INTRODUCTION_WEBHOOK_URL whenever a HUMAN marks a
// lead as Introduction — inbox label (single/bulk), portal Add Lead, or a
// portal stage move. AI auto-labeling is excluded by construction: the AI
// path (lib/ai/run.ts) writes label_assignments directly and never passes
// through the route handlers that call this helper. Do NOT move this into
// the client_pipeline_on_intro_label DB trigger — that trigger also fires
// for assigned_by='ai' and would re-include AI intros.
//
// Callers invoke this inside next/server `after(...)` so the POST runs
// post-response and never adds latency to (or breaks) the user's request.
// Every failure mode here is swallowed: a dead n8n must never block
// labeling or portal edits.

import { createAdminSupabase } from "@/lib/supabase/admin";
import { chunkedRun } from "@/lib/db/chunked-in";
import { env } from "@/lib/env";

export type IntroductionSource =
  | "inbox_label"
  | "inbox_bulk_label"
  | "portal_add_lead"
  | "portal_stage_change";

type PipelineRow = {
  id: string;
  client_id: string;
  stage: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  current_brokerage: string | null;
  // Embedded relations come back as object or array depending on the
  // FK cardinality PostgREST infers — handle both (see portal-data.ts).
  leads:
    | { company: string | null }
    | { company: string | null }[]
    | null;
  clients: { id: string; name: string } | { id: string; name: string }[] | null;
};

function first<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

// Notify n8n for the given client_pipeline_entries ids. Rows whose stage
// is not 'introduction' are skipped, so callers can pass ids without
// re-checking. One POST per entry.
export async function notifyIntroduction(
  entryIds: string[],
  source: IntroductionSource,
): Promise<void> {
  try {
    const url = env.N8N_INTRODUCTION_WEBHOOK_URL;
    if (!url || entryIds.length === 0) return;

    const admin = createAdminSupabase();

    const chunks = await chunkedRun(entryIds, (slice) =>
      admin
        .from("client_pipeline_entries")
        .select(
          "id, client_id, stage, lead_name, lead_email, lead_phone, current_brokerage, leads:lead_id (company), clients:client_id (id, name)",
        )
        .in("id", slice),
    );
    const rows = chunks
      .flatMap((c) => (c.data ?? []) as PipelineRow[])
      .filter((r) => r.stage === "introduction");
    if (rows.length === 0) return;

    // One team query for all affected clients, grouped in memory.
    const clientIds = [...new Set(rows.map((r) => r.client_id))];
    const teamChunks = await chunkedRun(clientIds, (slice) =>
      admin
        .from("client_team_members")
        .select("client_id, name, phone")
        .in("client_id", slice)
        .eq("active", true)
        .not("phone", "is", null),
    );
    const teamByClient = new Map<string, { name: string; mobile: string }[]>();
    for (const chunk of teamChunks) {
      for (const m of (chunk.data ?? []) as {
        client_id: string;
        name: string;
        phone: string;
      }[]) {
        const list = teamByClient.get(m.client_id) ?? [];
        list.push({ name: m.name, mobile: m.phone });
        teamByClient.set(m.client_id, list);
      }
    }

    const occurredAt = new Date().toISOString();
    await Promise.all(
      rows.map(async (row) => {
        const client = first(row.clients);
        const lead = first(row.leads);
        const payload = {
          event: "lead.introduction",
          occurred_at: occurredAt,
          source,
          pipeline_entry_id: row.id,
          lead: {
            name: row.lead_name,
            email: row.lead_email,
            // Portal-added rows have no leads link — fall back to the
            // brokerage snapshot. Truthy check so '' doesn't shadow it.
            company: lead?.company || row.current_brokerage || null,
            phone: row.lead_phone,
          },
          client: { id: row.client_id, name: client?.name ?? null },
          team: teamByClient.get(row.client_id) ?? [],
        };
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            console.error(
              `[n8n-introduction] webhook responded ${res.status} for entry ${row.id}`,
            );
          }
        } catch (err) {
          console.error(
            `[n8n-introduction] webhook POST failed for entry ${row.id}:`,
            err,
          );
        }
      }),
    );
  } catch (err) {
    console.error("[n8n-introduction] notify failed:", err);
  }
}

// Inbox paths know thread ids, not pipeline entry ids — the DB trigger
// (migration 0023) creates the pipeline row when the Introduction label
// lands. Resolve threads → entries here; threads without a pipeline row
// (e.g. no client_id) drop out naturally.
export async function notifyIntroductionForThreads(
  threadIds: string[],
  source: IntroductionSource,
): Promise<void> {
  try {
    if (!env.N8N_INTRODUCTION_WEBHOOK_URL || threadIds.length === 0) return;
    const admin = createAdminSupabase();
    const chunks = await chunkedRun(threadIds, (slice) =>
      admin
        .from("client_pipeline_entries")
        .select("id")
        .in("thread_id", slice)
        .eq("stage", "introduction"),
    );
    const ids = chunks.flatMap((c) =>
      ((c.data ?? []) as { id: string }[]).map((r) => r.id),
    );
    await notifyIntroduction(ids, source);
  } catch (err) {
    console.error("[n8n-introduction] thread resolve failed:", err);
  }
}
