import { createAdminSupabase } from "@/lib/supabase/admin";
import type { UnipileWebhookEvent } from "@/lib/unipile/types";

// Same explicit select-then-insert/update pattern as the EmailBison sync, for
// the same reason: our unique indexes on unipile_* mirror columns are partial.

async function resolveContext(accountId: string | undefined): Promise<
  { workspaceId: string; channelId: string | null } | null
> {
  const supabase = createAdminSupabase();
  if (accountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("id, workspace_id")
      .eq("provider", "unipile")
      .eq("unipile_account_id", accountId)
      .limit(1)
      .maybeSingle();
    if (channel) return { workspaceId: channel.workspace_id, channelId: channel.id };
  }
  const { data: any1 } = await supabase
    .from("channels")
    .select("id, workspace_id")
    .eq("provider", "unipile")
    .limit(1)
    .maybeSingle();
  if (any1) return { workspaceId: any1.workspace_id, channelId: any1.id };
  const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
  if (ws) return { workspaceId: ws.id, channelId: null };
  return null;
}

async function upsertLeadByAttendee(
  workspaceId: string,
  attendeeId: string,
  name: string | null,
  linkedinUrl: string | null,
): Promise<string | null> {
  const supabase = createAdminSupabase();
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("unipile_attendee_id", attendeeId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("leads")
      .update({ full_name: name, linkedin_url: linkedinUrl, last_activity_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data: inserted } = await supabase
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      unipile_attendee_id: attendeeId,
      full_name: name,
      linkedin_url: linkedinUrl,
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return inserted?.id ?? null;
}

async function upsertThreadByChat(
  workspaceId: string,
  channelId: string | null,
  leadId: string | null,
  chatId: string,
  subject: string | null,
  timestamp: string,
  preview: string | null,
): Promise<string | null> {
  const supabase = createAdminSupabase();
  const { data: existing } = await supabase
    .from("threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("unipile_chat_id", chatId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("threads")
      .update({
        channel_id: channelId,
        lead_id: leadId,
        subject,
        last_message_at: timestamp,
        last_message_preview: preview?.slice(0, 200) ?? null,
        needs_reply: true,
      })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data: inserted } = await supabase
    .from("threads")
    .insert({
      workspace_id: workspaceId,
      channel_id: channelId,
      lead_id: leadId,
      subject,
      last_message_at: timestamp,
      last_message_preview: preview?.slice(0, 200) ?? null,
      unipile_chat_id: chatId,
      needs_reply: true,
    })
    .select("id")
    .single();
  return inserted?.id ?? null;
}

export async function handleUnipileEvent(event: UnipileWebhookEvent): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const ctx = await resolveContext(event.account_id);
  if (!ctx) return { ok: false, reason: "no workspace yet" };
  if (!event.chat_id || !event.message_id) {
    return { ok: false, reason: "missing chat_id or message_id" };
  }

  const attendeeId = event.sender?.attendee_provider_id ?? event.sender?.attendee_id;
  const leadId = attendeeId
    ? await upsertLeadByAttendee(
        ctx.workspaceId,
        attendeeId,
        event.sender?.attendee_name ?? null,
        event.sender?.profile_url ?? null,
      )
    : null;

  const threadId = await upsertThreadByChat(
    ctx.workspaceId,
    ctx.channelId,
    leadId,
    event.chat_id,
    event.message?.subject ?? null,
    event.message?.timestamp ?? new Date().toISOString(),
    event.message?.text ?? null,
  );
  if (!threadId) return { ok: false, reason: "thread upsert failed" };

  const supabase = createAdminSupabase();
  const externalId = `unipile:${event.message_id}`;
  const row = {
    workspace_id: ctx.workspaceId,
    thread_id: threadId,
    channel_id: ctx.channelId,
    direction: "inbound" as const,
    sender: event.sender?.attendee_name ?? null,
    recipients: {},
    subject: event.message?.subject ?? null,
    body_html: null,
    body_text: event.message?.text ?? null,
    sent_at: event.message?.timestamp ?? new Date().toISOString(),
    external_message_id: externalId,
    unipile_message_id: event.message_id,
    raw_payload: event as object,
  };
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("external_message_id", externalId)
    .maybeSingle();
  if (existing) {
    await supabase.from("messages").update(row).eq("id", existing.id);
  } else {
    await supabase.from("messages").insert(row);
  }
  return { ok: true };
}
