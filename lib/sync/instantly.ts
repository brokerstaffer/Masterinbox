import { createAdminSupabase } from "@/lib/supabase/admin";
import { labelInboundMessage } from "@/lib/ai/run";
import { loadAgents, loadAgentWithKey, createDraftForAgent } from "@/lib/ai/agent";
import { deriveClientIdFromCampaign } from "@/lib/clients/derive";
import type { InstantlyWebhookEnvelope } from "@/lib/instantly/types";

// Inbound-only sync for Instantly's `reply_received` event.
//
// Real envelope shape (verified live, NOT what the public docs claim):
// flat fields — `email_id`, `lead_email`, `campaign_id`, `campaign_name`,
// `reply_subject`, `reply_text`, `reply_html`, `email_account`, plus
// arbitrary lead custom variables at the top level (firstName, companyName,
// LicenseNumber, ...). See InstantlyWebhookEnvelope.
//
// Threading: Instantly doesn't put `thread_id` directly on the webhook —
// only in `unibox_url`. We use the same `(lead, campaign)` synthetic key
// as EmailBison's threading model so the inbox UX behaves the same way
// regardless of source: one thread per (lead_email, campaign_id).
//
// Outbound channels are auto-created the first time we see a new
// `email_account` (the OUR-side mailbox). The user never sets these up.

interface SyncContext {
  workspaceId: string;
  channelId: string | null;
}

async function resolveContext(eaccount: string | null | undefined): Promise<SyncContext | null> {
  const supabase = createAdminSupabase();

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

// Build the lead.custom_fields jsonb from every field on the envelope that
// isn't part of the canonical message/metadata set. Instantly enriches leads
// with phone, LinkedIn, jobTitle, license number, GCI, etc. — we want all
// of that preserved on the lead row.
function deriveCustomFields(envelope: InstantlyWebhookEnvelope): Record<string, unknown> {
  const RESERVED = new Set([
    "event_type", "timestamp", "workspace", "unibox_url",
    "email_id", "reply_subject", "reply_text", "reply_text_snippet", "reply_html",
    "email_account", "campaign_id", "campaign_name", "is_first", "step", "variant",
    "lead_email", "email", "firstName", "lastName", "companyName",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(envelope)) {
    if (RESERVED.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

async function upsertLead(
  ctx: SyncContext,
  envelope: InstantlyWebhookEnvelope,
): Promise<string | null> {
  const leadEmail = envelope.lead_email ?? envelope.email ?? null;
  if (!leadEmail) return null;

  const supabase = createAdminSupabase();
  const now = new Date().toISOString();
  const fullName =
    [envelope.firstName, envelope.lastName].filter(Boolean).join(" ") || null;
  const customFields = deriveCustomFields(envelope);

  // Lookup priority: by (workspace, email) — Instantly doesn't ship a
  // stable lead UUID on the webhook payload, so email is the canonical
  // identity. If a future payload includes a numeric lead id we'll add
  // a fallback lookup on instantly_lead_id.
  const { data: existing } = await supabase
    .from("leads")
    .select("id, custom_fields")
    .eq("workspace_id", ctx.workspaceId)
    .eq("email", leadEmail)
    .maybeSingle();

  if (existing) {
    // Merge custom_fields rather than overwrite — different webhooks might
    // carry different subsets of enrichment data.
    const merged = { ...(existing.custom_fields as Record<string, unknown> ?? {}), ...customFields };
    await supabase
      .from("leads")
      .update({
        full_name: fullName ?? undefined,
        company: envelope.companyName ?? undefined,
        title: envelope.jobTitle ?? undefined,
        custom_fields: merged,
        last_activity_at: now,
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("leads")
    .insert({
      workspace_id: ctx.workspaceId,
      email: leadEmail,
      full_name: fullName,
      company: envelope.companyName ?? null,
      title: envelope.jobTitle ?? null,
      custom_fields: customFields,
      source_campaign_id: envelope.campaign_id ?? null,
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

function threadExternalId(leadEmail: string, campaignId: string | null | undefined): string {
  // Mirror of EmailBison's `eb:lead:X:campaign:Y` scheme so threading
  // behaves identically across providers.
  return `in:lead:${leadEmail}:campaign:${campaignId ?? "none"}`;
}

async function upsertThread(
  ctx: SyncContext,
  ourLeadId: string,
  externalThreadId: string,
  defaults: {
    subject?: string | null;
    last_message_at: string;
    last_message_preview?: string | null;
    needs_reply: boolean;
    seen: boolean;
    outbound_sender_email?: string | null;
    client_id?: string | null;
  },
): Promise<string | null> {
  const supabase = createAdminSupabase();
  const { data: existing } = await supabase
    .from("threads")
    .select("id, subject, client_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("instantly_thread_id", externalThreadId)
    .maybeSingle();

  const update: Record<string, unknown> = {
    lead_id: ourLeadId,
    channel_id: ctx.channelId,
    source_provider: "instantly",
    last_message_at: defaults.last_message_at,
    needs_reply: defaults.needs_reply,
    seen: defaults.seen,
  };
  if (defaults.subject) update.subject = defaults.subject;
  if (defaults.last_message_preview !== undefined) {
    update.last_message_preview = defaults.last_message_preview?.slice(0, 200) ?? null;
  }
  if (defaults.outbound_sender_email !== undefined) {
    update.outbound_sender_email = defaults.outbound_sender_email;
  }
  if (defaults.client_id !== undefined) update.client_id = defaults.client_id;

  if (existing) {
    if (existing.subject) delete update.subject;
    if (existing.client_id) delete update.client_id;
    await supabase.from("threads").update(update).eq("id", existing.id);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("threads")
    .insert({
      workspace_id: ctx.workspaceId,
      ...update,
      instantly_thread_id: externalThreadId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[instantly] thread insert failed", error);
    return null;
  }
  return inserted?.id ?? null;
}

async function upsertMessage(args: {
  ctx: SyncContext;
  threadId: string;
  emailId: string;
  envelope: InstantlyWebhookEnvelope;
  bodyText: string | null;
}): Promise<void> {
  const supabase = createAdminSupabase();
  const { ctx, threadId, emailId, envelope, bodyText } = args;
  const externalMessageId = `in:email:${emailId}`;

  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("external_message_id", externalMessageId)
    .maybeSingle();

  const row = {
    workspace_id: ctx.workspaceId,
    thread_id: threadId,
    channel_id: ctx.channelId,
    source_provider: "instantly" as const,
    direction: "inbound" as const,
    sender: envelope.lead_email ?? envelope.email ?? null,
    recipients: envelope.email_account ? { to: [envelope.email_account] } : {},
    subject: envelope.reply_subject ?? null,
    body_html: envelope.reply_html ?? null,
    body_text: bodyText,
    sent_at: envelope.timestamp ?? new Date().toISOString(),
    external_message_id: externalMessageId,
    instantly_email_id: emailId,
  };

  if (existing) {
    await supabase.from("messages").update(row).eq("id", existing.id);
  } else {
    const { error } = await supabase.from("messages").insert({
      ...row,
      raw_payload: envelope as object,
    });
    if (error) console.error("[instantly] message insert failed", error);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function handleInstantlyEvent(envelope: InstantlyWebhookEnvelope): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const eventType = envelope.event_type;
  if (!eventType) return { ok: false, reason: "missing event_type" };
  if (eventType !== "reply_received") {
    return { ok: true, reason: `ignored event type: ${eventType}` };
  }

  const emailId = envelope.email_id;
  const leadEmail = envelope.lead_email ?? envelope.email ?? null;
  if (!emailId || !leadEmail) {
    return { ok: false, reason: "missing email_id or lead_email" };
  }

  const ctx = await resolveContext(envelope.email_account ?? null);
  if (!ctx) return { ok: false, reason: "no workspace mapping" };

  const ourLeadId = await upsertLead(ctx, envelope);
  if (!ourLeadId) return { ok: false, reason: "lead upsert failed" };

  const externalThreadId = threadExternalId(leadEmail, envelope.campaign_id);

  // Body: prefer reply_text (already plain text), fall back to stripped HTML,
  // then to the snippet Instantly provides for previews.
  const bodyText =
    envelope.reply_text ??
    (envelope.reply_html ? stripHtml(envelope.reply_html) : null) ??
    envelope.reply_text_snippet ??
    null;

  // Client tag from campaign name (Instantly conveniently includes the name
  // directly in the envelope — no extra /campaigns/{id} call needed).
  const clientId = await deriveClientIdFromCampaign(envelope.campaign_name ?? null);

  const threadId = await upsertThread(ctx, ourLeadId, externalThreadId, {
    subject: envelope.reply_subject ?? null,
    last_message_at: envelope.timestamp ?? new Date().toISOString(),
    last_message_preview: bodyText,
    needs_reply: true,
    seen: false,
    outbound_sender_email: envelope.email_account ?? null,
    client_id: clientId,
  });
  if (!threadId) return { ok: false, reason: "thread upsert failed" };

  await upsertMessage({ ctx, threadId, emailId, envelope, bodyText });

  // AI labeling on the inbound message (no-op if not configured for this
  // workspace). Errors swallowed so labeling can never block a webhook ack.
  try {
    await labelInboundMessage({
      workspaceId: ctx.workspaceId,
      threadId,
      messageId: `in:email:${emailId}`,
      subject: envelope.reply_subject ?? null,
      bodyText,
      bodyHtml: envelope.reply_html ?? null,
    });
  } catch (err) {
    console.error("[ai] labelInboundMessage (instantly) failed", err);
  }

  // Reply agent — pick the first matching active email agent and draft.
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
          leadName: [envelope.firstName, envelope.lastName].filter(Boolean).join(" ") || null,
          leadEmail,
          ourName: null,
          ourEmail: envelope.email_account ?? null,
          subject: envelope.reply_subject ?? null,
          inboundBody: bodyText ?? "",
        });
      }
    }
  } catch (err) {
    console.error("[agents] instantly draft generation failed", err);
  }

  return { ok: true };
}
