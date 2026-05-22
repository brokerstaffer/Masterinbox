import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadAiConfigWithKey } from "@/lib/ai/config";
import { classifyReply, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/label";
import { isHostileLabel, markThreadLeadDoNotContact } from "@/lib/inbox/dnc";

interface LabelInboundInput {
  workspaceId: string;
  threadId: string;
  messageId: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  // When true, ignore the workspace's `enabled` flag and the
  // `relabel_ongoing` gate. Used by the backfill endpoint so explicit
  // "Run" clicks always do work.
  force?: boolean;
}

export type LabelResult =
  | { status: "labeled"; label: string }
  | { status: "skipped_disabled" | "skipped_no_key" | "skipped_no_config" }
  | { status: "skipped_already_labeled" }
  | { status: "skipped_no_labels" }
  | { status: "skipped_model_returned_none" }
  | { status: "skipped_no_match"; raw: string }
  | { status: "errored"; error: string };

// Labels a single inbound message. Fetches the workspace's AI config +
// candidate labels, calls the provider, upserts a thread label_assignment
// with assigned_by='ai'.
//
// Returns a discriminated result so callers can report *why* a thread
// wasn't labeled rather than just "nothing happened".
export async function labelInboundMessage(input: LabelInboundInput): Promise<LabelResult> {
  const cfg = await loadAiConfigWithKey(input.workspaceId);
  if (!cfg) return { status: "skipped_no_config" };
  if (!cfg.api_key) return { status: "skipped_no_key" };
  if (!cfg.enabled && !input.force) return { status: "skipped_disabled" };

  const admin = createAdminSupabase();

  // Skip if the thread already has an AI label and relabel_ongoing is off
  // (unless force=true — backfill always re-labels for visibility).
  if (!cfg.relabel_ongoing && !input.force) {
    const { data: existing } = await admin
      .from("label_assignments")
      .select("id")
      .eq("target_type", "thread")
      .eq("target_id", input.threadId)
      .eq("assigned_by", "ai")
      .limit(1);
    if (existing && existing.length > 0) return { status: "skipped_already_labeled" };
  }

  // Pull candidate labels for this workspace. category_set narrows the pick
  // list; without it we expose every label.
  const { data: labelRows } = await admin
    .from("labels")
    .select("id, name")
    .eq("workspace_id", input.workspaceId)
    .order("sort_order", { ascending: true });
  if (!labelRows || labelRows.length === 0) return { status: "skipped_no_labels" };

  const candidateNames = cfg.category_set.length > 0
    ? cfg.category_set
    : labelRows.map((l) => l.name);

  let chosen: string | null = null;
  try {
    chosen = await classifyReply({
      provider: cfg.provider,
      apiKey: cfg.api_key,
      model: cfg.model,
      systemPrompt: cfg.use_custom_prompt && cfg.custom_prompt
        ? cfg.custom_prompt
        : DEFAULT_SYSTEM_PROMPT,
      candidateLabels: candidateNames,
      subject: input.subject,
      body: input.bodyText ?? stripHtml(input.bodyHtml ?? ""),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown classify error";
    console.error("[ai] classifyReply failed", err);
    return { status: "errored", error: msg };
  }

  if (!chosen) return { status: "skipped_model_returned_none" };
  const labelRow = labelRows.find((l) => l.name.toLowerCase() === chosen?.toLowerCase());
  if (!labelRow) return { status: "skipped_no_match", raw: chosen };

  // Re-label semantics: if relabel_ongoing OR force, wipe any existing AI
  // assignment on this thread so we don't accumulate stale labels.
  if (cfg.relabel_ongoing || input.force) {
    await admin
      .from("label_assignments")
      .delete()
      .eq("target_type", "thread")
      .eq("target_id", input.threadId)
      .eq("assigned_by", "ai");
  }

  await admin.from("label_assignments").upsert(
    {
      workspace_id: input.workspaceId,
      label_id: labelRow.id,
      target_type: "thread",
      target_id: input.threadId,
      assigned_by: "ai",
    },
    { onConflict: "label_id,target_type,target_id" },
  );

  // Hostile → auto Do-Not-Contact: push the lead onto the source
  // platform's blocklist so the sequencer stops emailing them.
  if (isHostileLabel(labelRow.name)) {
    await markThreadLeadDoNotContact(input.threadId);
  }

  await admin.rpc("ai_labeling_touch_run", { p_workspace: input.workspaceId });
  return { status: "labeled", label: labelRow.name };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface BackfillResult {
  scanned: number;
  labeled: number;
  no_inbound: number;
  skipped_already_labeled: number;
  skipped_disabled: number;
  skipped_no_key: number;
  skipped_no_config: number;
  skipped_no_labels: number;
  skipped_model_returned_none: number;
  skipped_no_match: number;
  errors: number;
  sample_labels: Array<{ thread_id: string; label: string }>;
  sample_errors: Array<{ thread_id: string; error: string }>;
}

// Bulk-label every open thread's most recent inbound. Always runs in force
// mode — the user explicitly clicked Run.
export async function backfillLabelsForWorkspace(workspaceId: string): Promise<BackfillResult> {
  const admin = createAdminSupabase();
  const { data: threads } = await admin
    .from("threads")
    .select("id, subject")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .limit(500);

  const result: BackfillResult = {
    scanned: 0,
    labeled: 0,
    no_inbound: 0,
    skipped_already_labeled: 0,
    skipped_disabled: 0,
    skipped_no_key: 0,
    skipped_no_config: 0,
    skipped_no_labels: 0,
    skipped_model_returned_none: 0,
    skipped_no_match: 0,
    errors: 0,
    sample_labels: [],
    sample_errors: [],
  };

  // Per-thread classification. Returns either "no_inbound" or the
  // LabelResult so the caller can tally it.
  type ThreadOutcome =
    | { kind: "no_inbound" }
    | { kind: "result"; threadId: string; result: LabelResult };

  async function classifyThread(t: {
    id: string;
    subject: string | null;
  }): Promise<ThreadOutcome> {
    const { data: msg } = await admin
      .from("messages")
      .select("id, subject, body_text, body_html")
      .eq("thread_id", t.id)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!msg) return { kind: "no_inbound" };
    const result = await labelInboundMessage({
      workspaceId,
      threadId: t.id,
      messageId: msg.id as string,
      subject: (msg.subject as string | null) ?? t.subject,
      bodyText: msg.body_text as string | null,
      bodyHtml: msg.body_html as string | null,
      force: true,
    });
    return { kind: "result", threadId: t.id, result };
  }

  // Run in bounded-concurrency batches — sequential was minutes-long and
  // timed the request out on a few hundred threads.
  const list = (threads ?? []) as Array<{ id: string; subject: string | null }>;
  const CONCURRENCY = 5;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = await Promise.all(list.slice(i, i + CONCURRENCY).map(classifyThread));
    for (const outcome of batch) {
      result.scanned++;
      if (outcome.kind === "no_inbound") {
        result.no_inbound++;
        continue;
      }
      const r = outcome.result;
      const t = { id: outcome.threadId };
      switch (r.status) {
      case "labeled":
        result.labeled++;
        if (result.sample_labels.length < 10) {
          result.sample_labels.push({ thread_id: t.id, label: r.label });
        }
        break;
      case "skipped_already_labeled":
        result.skipped_already_labeled++;
        break;
      case "skipped_disabled":
        result.skipped_disabled++;
        break;
      case "skipped_no_key":
        result.skipped_no_key++;
        break;
      case "skipped_no_config":
        result.skipped_no_config++;
        break;
      case "skipped_no_labels":
        result.skipped_no_labels++;
        break;
      case "skipped_model_returned_none":
        result.skipped_model_returned_none++;
        break;
      case "skipped_no_match":
        result.skipped_no_match++;
        if (result.sample_errors.length < 10) {
          result.sample_errors.push({
            thread_id: t.id,
            error: `Model returned "${r.raw}" — not in your label set`,
          });
        }
        break;
        case "errored":
          result.errors++;
          if (result.sample_errors.length < 10) {
            result.sample_errors.push({ thread_id: t.id, error: r.error });
          }
          break;
      }
    }
  }

  return result;
}
