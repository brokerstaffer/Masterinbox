import { createAdminSupabase } from "@/lib/supabase/admin";
import { createInstantlyClient } from "@/lib/instantly/client";
import { labelInboundMessage } from "@/lib/ai/run";
import { loadAgents, loadAgentWithKey, createDraftForAgent } from "@/lib/ai/agent";
import { deriveClientIdFromCampaign } from "@/lib/clients/derive";
import type {
  InstantlyEmail,
  InstantlyWebhookEnvelope,
} from "@/lib/instantly/types";

// Inbound-only sync (event = reply_received). Mirror of the EmailBison sync
// in lib/sync/emailbison.ts but adapted for Instantly's flat /emails model:
//   - Threading: Instantly already provides a thread_id per conversation;
//     we map that directly to threads.instantly_thread_id (no synthetic
//     `eb:lead:X:campaign:Y` composite key required).
//   - Channels: one channel per Instantly mailbox identity (eaccount string).
//     Auto-created on first sight so the user doesn't have to wire them up.
//   - Provider context: stamped on every thread + message at insert time as
//     source_provider='instantly', so the inbox UI can render the source
//     badge without joining through channel.provider.
//   - Client tagging: derived from the campaign name at thread insert time
//     (lib/clients/derive.ts). Falls back to the "Unknown" client when no
//     name matches.

interface SyncContext {
  workspaceId: string;
  channelId: string | null;
}

// Process-lifetime cache of campaign id -> name. Webhook payloads only carry
// the campaign UUID, so we fetch the name on first sight per campaign and
// reuse it for the lifetime of the lambda. Hot cache because campaign
// metadata doesn't change mid-conversation.
const campaignNameCache = new Map<string, string | null>();

async function resolveCampaignName(
  campaignId: string | null | undefined,
  hintFromPayload?: string | null,
): Promise<string | null> {
  if (!campaignId) return hintFromPayload ?? null;
  if (campaignNameCache.has(campaignId)) {
    return campaignNameCache.get(campaignId) ?? hintFromPayload ?? null;
  }
  if (hintFromPayload) {
    campaignNameCache.set(campaignId, hintFromPayload);
    return hintFromPayload;
  }
  try {
    const client = createInstantlyClient();
    const res = await client.getCampaign(campaignId);
    const name = res?.name ?? null;
    campaignNameCache.set(campaignId, name);
    return name;
  } catch (err) {
    console.error("[instantly] getCampaign failed", err);
    campaignNameCache.set(campaignId, null);
    return null;
  }
}

async function resolveContext(eaccount: string | null | undefined): Promise<SyncContext | null> {
  const supabase = createAdminSupabase();

  // Single-tenant: always the singleton workspace.
  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!ws) return null;

  let channelId: string | null = null;
  if (eaccount) {
    const { data: existing } = await supabase
      .from("channels")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("provider", "instantly")
      .eq("instantly_account_id", eaccount)
      .maybeSingle();
    if (existing) {
      channelId = existing.id;
    } else {
      // Auto-create a channel for this Instantly mailbox so threads can be
      // associated to it. status='connected' because the API key we hold
      // can clearly access this mailbox (it just sent us an event).
      const { data: created } = await supabase
        .from("channels")
        .insert({
          workspace_id: ws.id,
          type: "email",
          provider: "instantly",
          display_name: eaccount,
          instantly_account_id: eaccount,
          status: "connected",
          last_synced_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      channelId = created?.id ?? null;
    }
  }

  return { workspaceId: ws.id, channelId };
}

async function upsertLead(
  ctx: SyncContext,
  leadId: string | null | undefined,
  leadEmail: string | null | undefined,
  hints: { first_name?: string | null; last_name?: string | null; company?: string | null } = {},
): Promise<string | null> {
  if (!leadId && !leadEmail) return null;
  const supabase = createAdminSupabase();
  const now = new Date().toISOString();
  const fullName = [hints.first_name, hints.last_name].filter(Boolean).join(" ") || null;

  if (leadId) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("instantly_lead_id", leadId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("leads")
        .update({
          email: leadEmail ?? undefined,
          full_name: fullName ?? undefined,
          company: hints.company ?? undefined,
          last_activity_at: now,
        })
        .eq("id", existing.id);
      return existing.id;
    }
  }

  // Fall back to lookup by email when no instantly_lead_id is known.
  if (!leadId && leadEmail) {
    const { data: byEmail } = await supabase
      .from("leads")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("email", leadEmail)
      .maybeSingle();
    if (byEmail) {
      await supabase
        .from("leads")
        .update({ last_activity_at: now })
        .eq("id", byEmail.id);
      return byEmail.id;
    }
  }

  const { data: inserted, error } = await supabase
    .from("leads")
    .insert({
      workspace_id: ctx.workspaceId,
      instantly_lead_id: leadId ?? null,
      email: leadEmail ?? null,
      full_name: fullName,
      company: hints.company ?? null,
      first_seen_at: now,
      last_activity_at: now,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[instantly] lead insert failed", error);
    return null;
  }
  return inserted?.id ?? null;
}

async function upsertThread(
  ctx: SyncContext,
  ourLeadId: string,
  instantlyThreadId: string,
  defaults: {
    subject?: string | null;
    last_message_at?: string;
    last_message_preview?: string | null;
    needs_reply?: boolean;
    seen?: boolean;
    outbound_sender_email?: string | null;
    client_id?: string | null;
  },
): Promise<string | null> {
  const supabase = createAdminSupabase();
  const { data: existing } = await supabase
    .from("threads")
    .select("id, subject, client_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("instantly_thread_id", instantlyThreadId)
    .maybeSingle();

  const update: Record<string, unknown> = {
    lead_id: ourLeadId,
    channel_id: ctx.channelId,
    source_provider: "instantly",
  };
  if (defaults.subject) update.subject = defaults.subject;
  if (defaults.last_message_at) update.last_message_at = defaults.last_message_at;
  if (defaults.last_message_preview !== undefined) {
    update.last_message_preview = defaults.last_message_preview?.slice(0, 200) ?? null;
  }
  if (defaults.needs_reply !== undefined) update.needs_reply = defaults.needs_reply;
  if (defaults.seen !== undefined) update.seen = defaults.seen;
  if (defaults.outbound_sender_email !== undefined) {
    update.outbound_sender_email = defaults.outbound_sender_email;
  }
  if (defaults.client_id !== undefined) update.client_id = defaults.client_id;

  if (existing) {
    if (existing.subject) delete update.subject;
    // Don't overwrite an already-set client_id — first derivation wins.
    if (existing.client_id) delete update.client_id;
    await supabase.from("threads").update(update).eq("id", existing.id);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("threads")
    .insert({
      workspace_id: ctx.workspaceId,
      ...update,
      instantly_thread_id: instantlyThreadId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[instantly] thread insert failed", error);
    return null;
  }
  return inserted?.id ?? null;
}

interface MessageUpsertInput {
  ctx: SyncContext;
  threadId: string;
  direction: "inbound" | "outbound";
  externalMessageId: string;
  instantly_email_id: string;
  sender: string | null;
  recipients: Record<string, unknown>;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  raw_payload: unknown;
}

async function upsertMessage(input: MessageUpsertInput): Promise<void> {
  const supabase = createAdminSupabase();
  const { ctx, threadId, externalMessageId, raw_payload, ...rest } = input;

  const row = {
    workspace_id: ctx.workspaceId,
    thread_id: threadId,
    channel_id: ctx.channelId,
    source_provider: "instantly",
    ...rest,
    external_message_id: externalMessageId,
    raw_payload: raw_payload as object,
  };

  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("external_message_id", externalMessageId)
    .maybeSingle();
  if (existing) {
    // Preserve original raw_payload (first write wins — the webhook delivery).
    const { raw_payload: _drop, ...preserveable } = row;
    void _drop;
    await supabase.from("messages").update(preserveable).eq("id", existing.id);
  } else {
    const { error } = await supabase.from("messages").insert(row);
    if (error) console.error("[instantly] message insert failed", error);
  }
}

function deriveDirection(email: InstantlyEmail, eaccount: string | null): "inbound" | "outbound" {
  // Instantly's ue_type is the most reliable signal: 1 = sent, 2 = received.
  // Fall back to comparing from_address against the eaccount.
  if (email.ue_type === 1) return "outbound";
  if (email.ue_type === 2) return "inbound";
  if (
    eaccount &&
    email.from_address_email &&
    eaccount.toLowerCase() === email.from_address_email.toLowerCase()
  ) {
    return "outbound";
  }
  return "inbound";
}

function externalMessageIdForEmail(emailId: string): string {
  return `in:email:${emailId}`;
}

function parseRecipients(email: InstantlyEmail): Record<string, unknown> {
  const split = (csv: string | null | undefined) =>
    csv
      ? csv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const json = (rows: { address?: string }[] | undefined): string[] =>
    rows ? rows.map((r) => r.address ?? "").filter(Boolean) : [];

  return {
    to: email.to_address_json ? json(email.to_address_json) : split(email.to_address_email_list),
    cc: email.cc_address_json ? json(email.cc_address_json) : split(email.cc_address_email_list),
    bcc: email.bcc_address_json ? json(email.bcc_address_json) : split(email.bcc_address_email_list),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pulls every email in the same Instantly thread and upserts each. Idempotent
// because of the unique (workspace_id, external_message_id) constraint.
async function backfillThread(
  ctx: SyncContext,
  ourThreadId: string,
  instantlyThreadId: string,
): Promise<void> {
  let client;
  try {
    client = createInstantlyClient();
  } catch (err) {
    console.error("[instantly] cannot construct client for backfill", err);
    return;
  }
  try {
    const res = await client.listEmails({ thread_id: instantlyThreadId, limit: 100 });
    for (const email of res.items ?? []) {
      const direction = deriveDirection(email, email.eaccount ?? null);
      const bodyText = email.body?.text ?? stripHtml(email.body?.html ?? "");
      await upsertMessage({
        ctx,
        threadId: ourThreadId,
        direction,
        externalMessageId: externalMessageIdForEmail(email.id),
        instantly_email_id: email.id,
        sender: email.from_address_email ?? null,
        recipients: parseRecipients(email),
        subject: email.subject ?? null,
        body_html: email.body?.html ?? null,
        body_text: bodyText || null,
        sent_at: email.timestamp_email ?? email.timestamp_created ?? new Date().toISOString(),
        raw_payload: email,
      });
    }
  } catch (err) {
    console.error("[instantly] listEmails (thread backfill) failed", err);
  }
}

export async function handleInstantlyEvent(envelope: InstantlyWebhookEnvelope): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const eventType = envelope?.event_type;
  if (!eventType) return { ok: false, reason: "missing event_type" };
  if (eventType !== "reply_received") {
    return { ok: true, reason: `ignored event type: ${eventType}` };
  }

  const email = envelope.email;
  if (!email || !email.id) return { ok: false, reason: "missing email payload" };

  const ctx = await resolveContext(email.eaccount ?? null);
  if (!ctx) return { ok: false, reason: "no workspace mapping" };

  const ourLeadId = await upsertLead(
    ctx,
    email.lead_id ?? null,
    email.lead ?? email.from_address_email ?? null,
    {
      first_name: envelope.lead?.first_name ?? null,
      last_name: envelope.lead?.last_name ?? null,
      company: envelope.lead?.company ?? null,
    },
  );
  if (!ourLeadId) return { ok: false, reason: "lead upsert failed" };

  const instantlyThreadId = email.thread_id;
  if (!instantlyThreadId) return { ok: false, reason: "missing thread_id" };

  const bodyText = email.body?.text ?? stripHtml(email.body?.html ?? "") ?? email.content_preview ?? null;
  const direction = deriveDirection(email, email.eaccount ?? null);

  // Resolve client tag from the campaign name. The webhook may include the
  // campaign name directly (envelope.campaign.name) — prefer that so we
  // don't burn a /campaigns/{id} call. Falls back to /campaigns/{id}, then
  // to the "Unknown" client.
  const campaignName = await resolveCampaignName(
    email.campaign_id ?? null,
    envelope.campaign?.name ?? null,
  );
  const clientId = await deriveClientIdFromCampaign(campaignName);

  const threadId = await upsertThread(ctx, ourLeadId, instantlyThreadId, {
    subject: email.subject ?? null,
    last_message_at: email.timestamp_email ?? new Date().toISOString(),
    last_message_preview: bodyText,
    needs_reply: direction === "inbound",
    seen: direction !== "inbound",
    outbound_sender_email: email.eaccount ?? null,
    client_id: clientId,
  });
  if (!threadId) return { ok: false, reason: "thread upsert failed" };

  // Insert the triggering reply first (always inbound for reply_received).
  await upsertMessage({
    ctx,
    threadId,
    direction,
    externalMessageId: externalMessageIdForEmail(email.id),
    instantly_email_id: email.id,
    sender: email.from_address_email ?? null,
    recipients: parseRecipients(email),
    subject: email.subject ?? null,
    body_html: email.body?.html ?? null,
    body_text: bodyText,
    sent_at: email.timestamp_email ?? new Date().toISOString(),
    raw_payload: envelope,
  });

  // Backfill the rest of the thread (sent + received) so the conversation
  // view is complete on first open. Synchronous: same model as EmailBison —
  // one extra Instantly call per webhook (`GET /emails?thread_id=...`).
  await backfillThread(ctx, threadId, instantlyThreadId);

  // AI labeling on the inbound message. No-ops if AI labeling isn't enabled
  // for this workspace. Errors are swallowed so labeling failures never
  // block a webhook ack.
  if (direction === "inbound") {
    try {
      await labelInboundMessage({
        workspaceId: ctx.workspaceId,
        threadId,
        messageId: externalMessageIdForEmail(email.id),
        subject: email.subject ?? null,
        bodyText,
        bodyHtml: email.body?.html ?? null,
      });
    } catch (err) {
      console.error("[ai] labelInboundMessage (instantly) failed", err);
    }

    // Reply agents — pick the first active email-channel agent and draft a
    // single reply. Same approach as EmailBison sync.
    try {
      const candidate = (await loadAgents(ctx.workspaceId))
        .filter((a) => a.active)
        .filter((a) => a.channel_filter === "both" || a.channel_filter === "email")
        .filter((a) => {
          if (a.channel_ids.length === 0) return true;
          return ctx.channelId !== null && a.channel_ids.includes(ctx.channelId);
        })
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];

      if (candidate) {
        const full = await loadAgentWithKey(candidate.id);
        if (full && full.api_key) {
          await createDraftForAgent({
            workspaceId: ctx.workspaceId,
            threadId,
            agent: full,
            leadName: [envelope.lead?.first_name, envelope.lead?.last_name].filter(Boolean).join(" ") || null,
            leadEmail: email.lead ?? email.from_address_email ?? null,
            ourName: null,
            ourEmail: email.eaccount ?? null,
            subject: email.subject ?? null,
            inboundBody: bodyText ?? "",
          });
        }
      }
    } catch (err) {
      console.error("[agents] instantly draft generation failed", err);
    }
  }

  return { ok: true };
}
