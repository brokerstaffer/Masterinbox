import { NextResponse, after } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { clientHasFeature } from "@/lib/portals/feature-flags";
import { notifyIntroduction } from "@/lib/webhooks/n8n-introduction";
import { pushPipelineEntryToFub } from "@/lib/integrations/push-pipeline-entry";

// POST /api/portal/[token]/pipeline/csv — bulk-import leads from a
// CSV file uploaded via the portal "Upload CSV" button. Gated behind
// the pipeline_csv_upload feature flag — clients without it get a
// vanilla 404 (no information leak about the hidden feature).
//
// CSV column shape mirrors the manual "Add candidate" form. Header
// row is required, case-insensitive, order-independent. Only
// lead_name is required; everything else is optional.
//
//   lead_name (required)
//   lead_email
//   lead_phone
//   current_brokerage
//   agent_profile_url
//   introduced_at        (ISO date — defaults to now)
//   stage                (defaults to "introduction")
//   needs_replacement    (truthy strings: true/yes/1)
//
// Returns { inserted: N, skipped: [{row, reason}] } so the UI can
// surface row-level errors without a second round-trip.

export const dynamic = "force-dynamic";

const STAGES = new Set([
  "introduction",
  "phone_screen_scheduled",
  "phone_screen",
  "interview_scheduled",
  "interview",
  "hired",
  "keep_warm",
  "we_they_rejected",
  "no_show",
]);

const MAX_ROWS = 1000;

interface SkippedRow {
  row: number;
  reason: string;
}

interface ParsedRow {
  lead_name: string;
  lead_email: string | null;
  lead_phone: string | null;
  current_brokerage: string | null;
  agent_profile_url: string | null;
  introduced_at: string | null;
  stage: string;
  needs_replacement: boolean;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }
  // Hard 404 when the feature flag is off so real clients can't
  // discover the route by curling it. Matches the safety contract
  // in lib/portals/feature-flags.ts.
  if (!clientHasFeature(client, "pipeline_csv_upload")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "CSV file is too large (max 5 MB)" },
      { status: 400 },
    );
  }

  const text = await file.text();
  const lines = splitCsvLines(text);
  if (lines.length === 0) {
    return NextResponse.json({ error: "CSV is empty" }, { status: 400 });
  }

  const headerCells = parseCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase(),
  );
  const colIdx: Record<string, number> = {};
  for (let i = 0; i < headerCells.length; i++) colIdx[headerCells[i]] = i;
  if (colIdx.lead_name === undefined) {
    return NextResponse.json(
      { error: "CSV must include a 'lead_name' column" },
      { status: 400 },
    );
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `CSV exceeds the ${MAX_ROWS}-row limit. Split it and upload in batches.` },
      { status: 400 },
    );
  }

  const skipped: SkippedRow[] = [];
  const rows: ParsedRow[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const lineNo = i + 2; // +1 for header, +1 for 1-based
    const raw = dataLines[i];
    if (!raw.trim()) continue; // skip blank lines silently
    const cells = parseCsvLine(raw);
    const pick = (key: string): string | null => {
      const idx = colIdx[key];
      if (idx === undefined) return null;
      const v = (cells[idx] ?? "").trim();
      return v ? v : null;
    };
    const name = pick("lead_name");
    if (!name) {
      skipped.push({ row: lineNo, reason: "lead_name is required" });
      continue;
    }
    const email = pick("lead_email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ row: lineNo, reason: `Invalid email: ${email}` });
      continue;
    }
    const stage = (pick("stage") ?? "introduction").toLowerCase();
    if (!STAGES.has(stage)) {
      skipped.push({ row: lineNo, reason: `Unknown stage: ${stage}` });
      continue;
    }
    const introducedRaw = pick("introduced_at");
    let introducedIso: string | null = null;
    if (introducedRaw) {
      const d = new Date(introducedRaw);
      if (Number.isNaN(d.getTime())) {
        skipped.push({ row: lineNo, reason: `Invalid date: ${introducedRaw}` });
        continue;
      }
      introducedIso = d.toISOString();
    }
    const needsRaw = pick("needs_replacement");
    const needsReplacement =
      needsRaw !== null && /^(true|yes|y|1)$/i.test(needsRaw);
    rows.push({
      lead_name: name,
      lead_email: email,
      lead_phone: pick("lead_phone"),
      current_brokerage: pick("current_brokerage"),
      agent_profile_url: pick("agent_profile_url"),
      introduced_at: introducedIso,
      stage,
      needs_replacement: needsReplacement,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped });
  }

  // Bulk-imported rows always land as Client Entry when source split
  // is on. If only the CSV flag is on (source-split still off), the
  // column default 'BrokerStaffer' applies — matches the manual
  // "Add candidate" form's behaviour under the same flag combo.
  const includeSource = clientHasFeature(client, "pipeline_source_split");

  const admin = createAdminSupabase();
  const insertRows = rows.map((r) => ({
    client_id: client.id,
    stage: r.stage,
    needs_replacement: r.needs_replacement,
    lead_name: r.lead_name,
    lead_email: r.lead_email,
    lead_phone: r.lead_phone,
    current_brokerage: r.current_brokerage,
    agent_profile_url: r.agent_profile_url,
    introduced_at: r.introduced_at ?? new Date().toISOString(),
    ...(includeSource ? { source: "Client Entry" } : {}),
  }));

  const { data: inserted, error } = await admin
    .from("client_pipeline_entries")
    .insert(insertRows)
    .select("id, stage");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Same Introduction-stage handling as the single-row POST. n8n
  // notifier + FUB auto-push fire for every row that lands as
  // Introduction. Push runs inside after() so the response returns
  // immediately even on a thousand-row import.
  const introIds = (inserted ?? [])
    .filter((r) => (r as { stage: string }).stage === "introduction")
    .map((r) => (r as { id: string }).id);
  if (introIds.length > 0) {
    after(() => notifyIntroduction(introIds, "portal_csv_upload"));
    if (client.fub_api_key_set) {
      const clientId = client.id;
      after(async () => {
        for (const id of introIds) {
          try {
            await pushPipelineEntryToFub(clientId, id);
          } catch (err) {
            console.error("[fub] csv auto-push failed", id, err);
          }
        }
      });
    }
  }

  return NextResponse.json({
    inserted: inserted?.length ?? 0,
    skipped,
  });
}

// Split a CSV blob into lines while respecting quoted fields that
// contain real newlines. Tiny state machine; avoids pulling in a
// dependency for the ~1 KB job.
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        buf += ch;
      }
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) lines.push(buf);
  return lines;
}

// Parse a single CSV row into its cell values. Honours double-quoted
// fields with embedded commas / escaped quotes ("" -> ").
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}
