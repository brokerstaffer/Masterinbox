import { createServerSupabase } from "@/lib/supabase/server";

export interface MessageRow {
  id: string;
  direction: "inbound" | "outbound";
  sender: string | null;
  recipients: Record<string, unknown>;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  sent_at: string | null;
}

export interface PendingDraft {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  generated_body: string | null;
  created_at: string;
}

export interface ThreadDetail {
  id: string;
  workspace_id: string;
  subject: string | null;
  status: "open" | "archived" | "spam" | "trash" | "reminder";
  outbound_sender_email: string | null;
  // HTML signature from EmailBison for the sender account on this thread.
  // Extracted from any inbound message's raw_payload.data.sender_email.email_signature.
  // Used by the composer when the "Add signature" checkbox is on.
  outbound_sender_signature: string | null;
  pending_draft: PendingDraft | null;
  lead: {
    id: string | null;
    full_name: string | null;
    email: string | null;
    company: string | null;
    title: string | null;
    linkedin_url: string | null;
    custom_fields: Record<string, unknown>;
  };
  channel: { provider: "emailbison" | "unipile" | null; display_name: string | null };
  messages: MessageRow[];
  labels: Array<{ id: string; name: string; color: string; sentiment: string }>;
}

export async function loadThreadDetail(
  workspaceId: string,
  threadId: string,
): Promise<ThreadDetail | null> {
  const supabase = await createServerSupabase();

  const { data: thread, error } = await supabase
    .from("threads")
    .select(
      `id, workspace_id, subject, status, outbound_sender_email,
       leads:lead_id(id, full_name, email, company, title, linkedin_url, custom_fields),
       channels:channel_id(provider, display_name)`,
    )
    .eq("id", threadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !thread) return null;

  const { data: messages } = await supabase
    .from("messages")
    .select("id, direction, sender, recipients, subject, body_html, body_text, sent_at")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true });

  // Pull the EmailBison sender_email.email_signature from the most recent
  // inbound's raw_payload. Single round trip — we use head:false so we get
  // the actual row back. Only inbound rows reliably carry the full webhook
  // envelope.
  const { data: signatureRow } = await supabase
    .from("messages")
    .select("raw_payload")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let outboundSignature: string | null = null;
  if (signatureRow?.raw_payload) {
    const p = signatureRow.raw_payload as Record<string, unknown>;
    const data = (p.data as Record<string, unknown> | undefined) ?? p;
    const se = data?.sender_email as { email_signature?: string } | undefined;
    if (typeof se?.email_signature === "string" && se.email_signature.trim().length > 0) {
      outboundSignature = se.email_signature;
    }
  }

  const { data: labelAssignments } = await supabase
    .from("label_assignments")
    .select("labels:label_id(id, name, color, sentiment)")
    .eq("target_type", "thread")
    .eq("target_id", threadId);

  // Most recent pending draft (if any) for this thread. We surface it in
  // the composer as the starting body — the user can edit and send.
  const { data: drafts } = await supabase
    .from("reply_drafts")
    .select(
      "id, agent_id, generated_body, created_at, reply_agents:agent_id(name)",
    )
    .eq("thread_id", threadId)
    .eq("status", "pending")
    .not("generated_body", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const draftRow = drafts?.[0];
  const draftAgent = draftRow
    ? Array.isArray(draftRow.reply_agents)
      ? draftRow.reply_agents[0]
      : draftRow.reply_agents
    : null;

  const lead = Array.isArray(thread.leads) ? thread.leads[0] : thread.leads;
  const channel = Array.isArray(thread.channels) ? thread.channels[0] : thread.channels;
  const labels = (labelAssignments ?? [])
    .map((row) => (Array.isArray(row.labels) ? row.labels[0] : row.labels))
    .filter(Boolean) as ThreadDetail["labels"];

  return {
    id: thread.id,
    workspace_id: thread.workspace_id,
    subject: thread.subject,
    status: (thread.status as ThreadDetail["status"]) ?? "open",
    outbound_sender_email: (thread.outbound_sender_email as string | null) ?? null,
    outbound_sender_signature: outboundSignature,
    pending_draft: draftRow
      ? {
          id: draftRow.id as string,
          agent_id: (draftRow.agent_id as string | null) ?? null,
          agent_name: (draftAgent?.name as string | undefined) ?? null,
          generated_body: (draftRow.generated_body as string | null) ?? null,
          created_at: draftRow.created_at as string,
        }
      : null,
    lead: {
      id: lead?.id ?? null,
      full_name: lead?.full_name ?? null,
      email: lead?.email ?? null,
      company: lead?.company ?? null,
      title: lead?.title ?? null,
      linkedin_url: lead?.linkedin_url ?? null,
      custom_fields: (lead?.custom_fields as Record<string, unknown>) ?? {},
    },
    channel: {
      provider: (channel?.provider ?? null) as "emailbison" | "unipile" | null,
      display_name: channel?.display_name ?? null,
    },
    messages: (messages ?? []) as MessageRow[],
    labels,
  };
}
