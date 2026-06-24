import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { postSlackMessage } from "@/lib/webhooks/slack";
import { DEFAULT_STAGE_LABELS } from "@/lib/portals/portal-data";
import type { PipelineStage } from "@/lib/portals/portal-data";

// Slack notifications for client portal activity.
//
// Stephanie approved these message designs:
//   📋 Pipeline stage updated (general channel)
//   🎉 Agent hired (hiring channel)
//   📝 Note added (general channel)
//   🚫 / ✅ DNC list add/remove (general channel)
//   👥 Your Agents list add/remove (general channel)
//
// All exports:
//   • Never throw — try/catch wraps every DB read and the Slack
//     POST call. Errors land in console.error only.
//   • Caller wraps in `after(() => notify…())` from next/server
//     so the portal response has already returned.
//   • Silent no-op when SLACK_BOT_TOKEN / channel env are unset
//     (dev / preview).

const HIRED: PipelineStage = "hired";

function readableStage(s: string | null | undefined): string {
  if (!s) return "—";
  return DEFAULT_STAGE_LABELS[s as PipelineStage] ?? s;
}

function clipBody(body: string, max = 500): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trimEnd() + "…";
}

async function loadClientName(clientId: string): Promise<string | null> {
  try {
    const admin = createAdminSupabase();
    const { data } = await admin
      .from("clients")
      .select("name")
      .eq("id", clientId)
      .maybeSingle();
    return (data?.name as string | null) ?? null;
  } catch {
    return null;
  }
}

// --- Pipeline stage change ----------------------------------------------

export async function notifyPortalStageChange(args: {
  clientId: string;
  entryId: string;
  fromStage: string | null; // null when we couldn't read pre-state
  toStage: string;
}): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const [clientName, entryRow] = await Promise.all([
      loadClientName(args.clientId),
      admin
        .from("client_pipeline_entries")
        .select("lead_name, lead_email, thread_id, external_intro_id")
        .eq("id", args.entryId)
        .maybeSingle()
        .then((r) => r.data),
    ]);
    if (!clientName) return;

    const leadName =
      (entryRow?.lead_name as string | null) ?? "(unknown lead)";
    const leadEmail = (entryRow?.lead_email as string | null) ?? null;

    // Best-effort campaign name lookup. Threads carry it on the
    // canonical Nicole-introduction path; external_intros carry it
    // for the cold-outreach path; manual portal-add entries have
    // neither and we just omit the line.
    let campaignName: string | null = null;
    const threadId = entryRow?.thread_id as string | null | undefined;
    if (threadId) {
      const { data: t } = await admin
        .from("threads")
        .select("campaign_name")
        .eq("id", threadId)
        .maybeSingle();
      campaignName = (t?.campaign_name as string | null) ?? null;
    }
    if (!campaignName) {
      const extId = entryRow?.external_intro_id as string | null | undefined;
      if (extId) {
        const { data: ext } = await admin
          .from("external_intros")
          .select("campaign_name")
          .eq("id", extId)
          .maybeSingle();
        campaignName = (ext?.campaign_name as string | null) ?? null;
      }
    }

    const fromLabel = readableStage(args.fromStage);
    const toLabel = readableStage(args.toStage);

    if (args.toStage === HIRED) {
      const lines = [
        `🎉  *Agent hired at ${clientName}!*`,
        leadEmail ? `*${leadName}*  ·  ${leadEmail}` : `*${leadName}*`,
      ];
      if (campaignName) lines.push(`   Campaign: ${campaignName}`);
      lines.push(`   Previously: *${fromLabel}*`);
      await postSlackMessage({
        channel: env.SLACK_CHANNEL_HIRING,
        text: lines.join("\n"),
      });
      return;
    }

    const lines = [
      `📋  *Pipeline stage updated — ${clientName}*`,
      leadEmail ? `*${leadName}*  ·  ${leadEmail}` : `*${leadName}*`,
      `   *${fromLabel}*  →  *${toLabel}*`,
    ];
    if (campaignName) lines.push(`   Campaign: ${campaignName}`);
    await postSlackMessage({
      channel: env.SLACK_CHANNEL_PORTAL,
      text: lines.join("\n"),
    });
  } catch (err) {
    console.error("[slack-portal] notifyPortalStageChange failed", err);
  }
}

// --- Note added ---------------------------------------------------------

export async function notifyPortalNoteAdded(args: {
  clientId: string;
  entryId: string;
  noteBody: string;
}): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const [clientName, entryRow] = await Promise.all([
      loadClientName(args.clientId),
      admin
        .from("client_pipeline_entries")
        .select("lead_name, lead_email")
        .eq("id", args.entryId)
        .maybeSingle()
        .then((r) => r.data),
    ]);
    if (!clientName) return;
    const leadName =
      (entryRow?.lead_name as string | null) ?? "(unknown lead)";
    const leadEmail = (entryRow?.lead_email as string | null) ?? null;
    const quoted = clipBody(args.noteBody)
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const lines = [
      `📝  *Note added — ${clientName}*`,
      leadEmail
        ? `On  *${leadName}*  ·  ${leadEmail}`
        : `On  *${leadName}*`,
      quoted,
    ];
    await postSlackMessage({
      channel: env.SLACK_CHANNEL_PORTAL,
      text: lines.join("\n"),
    });
  } catch (err) {
    console.error("[slack-portal] notifyPortalNoteAdded failed", err);
  }
}

// --- DNC list add / remove ---------------------------------------------

export async function notifyPortalDncChange(args: {
  clientId: string;
  // Pre-fetched fields so the helper works for DELETE paths too
  // (where the row no longer exists by the time we run).
  name: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  kind: "agent" | "company" | null;
  notes: string | null;
  op: "added" | "removed";
}): Promise<void> {
  try {
    const clientName = await loadClientName(args.clientId);
    if (!clientName) return;
    const who =
      (args.name && args.name.trim()) ||
      args.email ||
      args.phone ||
      args.domain ||
      "(unknown)";
    const handle =
      args.email || args.phone || args.domain || null;
    if (args.op === "added") {
      const lines = [
        `🚫  *DNC list — added to ${clientName}*`,
        handle ? `*${who}*  ·  ${handle}` : `*${who}*`,
      ];
      if (args.kind) lines.push(`   Kind: ${args.kind}`);
      if (args.notes && args.notes.trim().length > 0) {
        lines.push(`   Notes: ${clipBody(args.notes, 240)}`);
      }
      await postSlackMessage({
        channel: env.SLACK_CHANNEL_PORTAL,
        text: lines.join("\n"),
      });
    } else {
      const lines = [
        `✅  *DNC list — removed from ${clientName}*`,
        handle ? `*${who}*  ·  ${handle}` : `*${who}*`,
      ];
      await postSlackMessage({
        channel: env.SLACK_CHANNEL_PORTAL,
        text: lines.join("\n"),
      });
    }
  } catch (err) {
    console.error("[slack-portal] notifyPortalDncChange failed", err);
  }
}

// --- Your Agents add / remove ------------------------------------------

export async function notifyPortalAgentChange(args: {
  clientId: string;
  name: string | null;
  email: string | null;
  op: "added" | "removed";
}): Promise<void> {
  try {
    const clientName = await loadClientName(args.clientId);
    if (!clientName) return;
    const who = (args.name && args.name.trim()) || args.email || "(unknown)";
    if (args.op === "added") {
      const lines = [
        `👥  *Your Agents — added to ${clientName}*`,
        args.email ? `*${who}*  ·  ${args.email}` : `*${who}*`,
      ];
      await postSlackMessage({
        channel: env.SLACK_CHANNEL_PORTAL,
        text: lines.join("\n"),
      });
    } else {
      const lines = [
        `👥  *Your Agents — removed from ${clientName}*`,
        `*${who}*`,
      ];
      await postSlackMessage({
        channel: env.SLACK_CHANNEL_PORTAL,
        text: lines.join("\n"),
      });
    }
  } catch (err) {
    console.error("[slack-portal] notifyPortalAgentChange failed", err);
  }
}
