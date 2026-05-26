import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createEmailBisonClient } from "@/lib/emailbison/client";
import { createInstantlyClient, InstantlyError } from "@/lib/instantly/client";

// Sends an outbound reply for the given thread via EmailBison's
// POST /api/replies/{id}/reply endpoint.
//
// Two transport modes:
//   - JSON body (no attachments)            → application/json
//   - multipart/form-data (with attachments) → see below
//
// Multipart form fields (used by the composer when files are picked):
//   body, content_type, subject              — scalars
//   to, cc, bcc                              — JSON-stringified arrays
//   reply_all, inject_previous_email_body    — "0" | "1"
//   attachments                              — repeated File fields

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PER_FILE_MAX = 25 * 1024 * 1024; // 25 MB
const COMBINED_MAX = 50 * 1024 * 1024; // 50 MB

const recipientSchema = z.object({
  name: z.string().nullable().optional(),
  email_address: z.string().email(),
});

const schema = z.object({
  body: z.string().min(1, "Reply body is required"),
  subject: z.string().optional(),
  content_type: z.enum(["html", "text"]).default("html"),
  to: z.array(recipientSchema).optional(),
  cc: z.array(recipientSchema).optional(),
  bcc: z.array(recipientSchema).optional(),
  reply_all: z.boolean().default(false),
  inject_previous_email_body: z.boolean().default(true),
  // messages.id of the specific message the user clicked Reply on. When
  // omitted (the bottom floating Reply button) we fall back to the latest
  // inbound. When set, we use THAT message's provider id (Instantly
  // email_id / EmailBison reply_id) as the reply target so the outbound's
  // In-Reply-To header points at the right ancestor for Gmail threading.
  source_message_id: z.string().uuid().optional(),
});

type ParsedInput = z.infer<typeof schema>;

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;

  const userClient = await createServerSupabase();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Parse either JSON or multipart based on the inbound content-type.
  let payload: ParsedInput;
  let attachments: Array<{ name: string; blob: Blob }> = [];
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.startsWith("multipart/")) {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      const files: File[] = [];
      for (const [key, value] of form.entries()) {
        if (key === "attachments" || key === "attachments[]") {
          if (value instanceof File) files.push(value);
        } else if (key === "to" || key === "cc" || key === "bcc") {
          // Recipients arrive JSON-stringified from the client.
          try {
            fields[key] = JSON.parse(String(value));
          } catch {
            fields[key] = undefined;
          }
        } else if (key === "reply_all" || key === "inject_previous_email_body") {
          fields[key] = value === "1" || value === "true";
        } else {
          fields[key] = String(value);
        }
      }

      // Enforce attachment caps server-side too — never trust the client.
      let combined = 0;
      for (const f of files) {
        if (f.size > PER_FILE_MAX) {
          return NextResponse.json(
            { error: `"${f.name}" exceeds the 25MB per-file limit.` },
            { status: 413 },
          );
        }
        combined += f.size;
      }
      if (combined > COMBINED_MAX) {
        return NextResponse.json(
          { error: "Combined attachments exceed the 50MB limit." },
          { status: 413 },
        );
      }
      attachments = files.map((f) => ({ name: f.name, blob: f }));
      const parsed = schema.safeParse(fields);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      payload = parsed.data;
    } else {
      const json = await request.json().catch(() => null);
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      payload = parsed.data;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bad request" },
      { status: 400 },
    );
  }

  // Membership check via user-scoped RLS — only members of the workspace
  // owning this thread can see/reply to it.
  const { data: thread } = await userClient
    .from("threads")
    .select("id, workspace_id, lead_id, channel_id, outbound_sender_email, source_provider, instantly_thread_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const admin = createAdminSupabase();

  // Instantly threads use a completely different send API. Dispatch early so
  // the rest of this handler can stay EmailBison-specific.
  if (thread.source_provider === "instantly") {
    return sendInstantlyReply({
      admin,
      threadId,
      workspaceId: thread.workspace_id,
      outboundSenderEmail: thread.outbound_sender_email,
      payload,
      attachments,
    });
  }

  // EmailBison team_id is pinned on the channel (one per sender_email)
  // — workspaces don't carry a team_id anymore in single-tenant BrokerStaffer
  // because brokerstaffer.com has multiple teams feeding one workspace.
  let ebTeamId: number | null = null;
  if (thread.channel_id) {
    const { data: ch } = await admin
      .from("channels")
      .select("emailbison_team_id")
      .eq("id", thread.channel_id)
      .maybeSingle();
    ebTeamId = (ch?.emailbison_team_id as number | null) ?? null;
  }
  if (ebTeamId === null) {
    return NextResponse.json(
      {
        error:
          "This thread's channel isn't linked to an EmailBison team yet. Wait for the next inbound reply on this sender, or re-register the webhook.",
      },
      { status: 400 },
    );
  }

  // Pick the EmailBison reply to hang our response off of. Same logic as
  // the Instantly path: prefer the user-clicked source message (so the
  // outbound's In-Reply-To header points at the right ancestor for Gmail
  // threading), fall back to the latest inbound for the bottom Reply
  // button which doesn't carry a source_message_id.
  let lastInbound: { id: string; emailbison_reply_id: string | null; raw_payload: unknown } | null = null;
  if (payload.source_message_id) {
    const { data } = await admin
      .from("messages")
      .select("id, emailbison_reply_id, raw_payload")
      .eq("id", payload.source_message_id)
      .eq("thread_id", threadId)
      .maybeSingle();
    lastInbound = data ?? null;
  }
  if (!lastInbound?.emailbison_reply_id) {
    const { data } = await admin
      .from("messages")
      .select("id, emailbison_reply_id, raw_payload")
      .eq("thread_id", threadId)
      .eq("direction", "inbound")
      .not("emailbison_reply_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastInbound = data ?? null;
  }
  if (!lastInbound?.emailbison_reply_id) {
    return NextResponse.json(
      { error: "No inbound EmailBison reply found to reply to." },
      { status: 400 },
    );
  }

  // EmailBison requires sender_email_id when reply_all=false. Pulled from
  // the canonical location in the webhook envelope:
  //   raw_payload.data.sender_email.id
  // This is always present on LEAD_REPLIED — it's OUR connected account
  // that received the reply.
  const inboundPayload = (lastInbound.raw_payload ?? {}) as Record<string, unknown>;
  const dataBlock = inboundPayload.data as Record<string, unknown> | undefined;
  const senderEmailId =
    (dataBlock?.sender_email as { id?: number } | undefined)?.id ?? null;
  if (!senderEmailId) {
    return NextResponse.json(
      { error: "sender_email.id missing from inbound payload — cannot reply." },
      { status: 500 },
    );
  }

  // Default `to` to the lead when none supplied + reply_all is false.
  let toEmails = payload.to;
  if (!payload.reply_all && (!toEmails || toEmails.length === 0)) {
    const { data: lead } = await admin
      .from("leads")
      .select("email, full_name")
      .eq("id", thread.lead_id)
      .maybeSingle();
    if (lead?.email) {
      toEmails = [{ name: lead.full_name ?? null, email_address: lead.email }];
    }
  }

  // Send via EmailBison.
  const eb = createEmailBisonClient();
  let newReplyId: number | null = null;
  try {
    await eb.switchWorkspace(ebTeamId);
    if (attachments.length > 0) {
      const res = await eb.sendReplyMultipart(Number(lastInbound.emailbison_reply_id), {
        message: payload.body,
        content_type: payload.content_type,
        to_emails: toEmails,
        cc_emails: payload.cc && payload.cc.length > 0 ? payload.cc : undefined,
        bcc_emails: payload.bcc && payload.bcc.length > 0 ? payload.bcc : undefined,
        reply_all: payload.reply_all,
        inject_previous_email_body: payload.inject_previous_email_body,
        sender_email_id: payload.reply_all ? null : senderEmailId,
        attachments,
      });
      // Response shape: { data: { success, reply: { id } } }
      newReplyId = res?.data?.reply?.id ?? null;
    } else {
      const res = await eb.sendReply(Number(lastInbound.emailbison_reply_id), {
        message: payload.body,
        content_type: payload.content_type,
        to_emails: toEmails,
        cc_emails: payload.cc && payload.cc.length > 0 ? payload.cc : undefined,
        bcc_emails: payload.bcc && payload.bcc.length > 0 ? payload.bcc : undefined,
        reply_all: payload.reply_all,
        inject_previous_email_body: payload.inject_previous_email_body,
        sender_email_id: payload.reply_all ? null : senderEmailId,
      });
      // Response shape: { data: { success, reply: { id } } }
      newReplyId = res?.data?.reply?.id ?? null;
    }
  } catch (err) {
    // EmailBisonError carries the response body. Surface it so the UI shows
    // what EmailBison actually rejected (422 etc) rather than a vague 502.
    type EBError = { message?: string; status?: number; body?: unknown };
    const e = err as EBError;
    const eBody = e?.body;
    console.error("[reply] EmailBison error:", {
      status: e?.status,
      message: e?.message,
      body: eBody,
    });
    const detail =
      typeof eBody === "string"
        ? eBody.slice(0, 500)
        : eBody
          ? JSON.stringify(eBody).slice(0, 500)
          : undefined;
    return NextResponse.json(
      {
        error: e?.message ?? "EmailBison send failed",
        status: e?.status ?? null,
        detail,
      },
      { status: 502 },
    );
  }

  // Record the outbound message immediately so the UI updates without
  // waiting for the webhook echo. external_message_id MUST match the id
  // the conversation-thread backfill will compute later, otherwise we end
  // up with a duplicate row. We use the new reply id returned from
  // EmailBison's send response — the backfill uses the same `eb:reply:<id>`
  // scheme so the second write becomes an idempotent update.
  const outboundId = newReplyId
    ? `eb:reply:${newReplyId}`
    : `eb-out:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const recipientsPayload = {
    to: toEmails?.map((r) => r.email_address) ?? [],
    cc: payload.cc?.map((r) => r.email_address) ?? [],
    bcc: payload.bcc?.map((r) => r.email_address) ?? [],
  };
  await admin.from("messages").insert({
    workspace_id: thread.workspace_id,
    thread_id: threadId,
    direction: "outbound",
    // Sender is the EmailBison sender account that actually sent the
    // message — NOT the logged-in user. They differ when a teammate hits
    // Send on a workspace where someone else owns the sender account.
    sender: thread.outbound_sender_email,
    recipients: recipientsPayload,
    subject: payload.subject ?? null,
    body_html: payload.content_type === "html" ? payload.body : null,
    body_text:
      payload.content_type === "text"
        ? payload.body
        : payload.body.replace(/<[^>]+>/g, ""),
    sent_at: new Date().toISOString(),
    external_message_id: outboundId,
    emailbison_reply_id: newReplyId ? String(newReplyId) : null,
  });
  await admin.from("threads").update({ needs_reply: false, seen: true }).eq("id", threadId);

  // Mark any pending drafts on this thread as sent — the user has acted on
  // the conversation and we don't want stale "review me" drafts hanging
  // around in the composer.
  await admin
    .from("reply_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("status", "pending");

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Instantly send dispatch.
// Instantly's POST /emails/reply takes the inbound email's UUID as
// `reply_to_uuid` and a single `eaccount` (the mailbox to send from).
// Attachments aren't documented on this endpoint, so we reject them
// explicitly and ask the user to send unattached for now.
// ---------------------------------------------------------------------------
async function sendInstantlyReply(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  threadId: string;
  workspaceId: string;
  outboundSenderEmail: string | null;
  payload: ParsedInput;
  attachments: Array<{ name: string; blob: Blob }>;
}): Promise<NextResponse> {
  const { admin, threadId, workspaceId, outboundSenderEmail, payload, attachments } = args;

  if (attachments.length > 0) {
    return NextResponse.json(
      { error: "Attachments are not supported on Instantly threads yet." },
      { status: 400 },
    );
  }

  // Pick the message Instantly should reply to. Preference order:
  //   1. The specific source message the user clicked Reply on
  //      (payload.source_message_id) — required for correct Gmail threading
  //      when the user replies to an older message in the conversation.
  //   2. Latest inbound on the thread — used by the bottom floating Reply
  //      button (source_message_id will be undefined).
  let replyTarget: { id: string; instantly_email_id: string | null; sender: string | null } | null = null;
  if (payload.source_message_id) {
    const { data } = await admin
      .from("messages")
      .select("id, instantly_email_id, sender")
      .eq("id", payload.source_message_id)
      .eq("thread_id", threadId)
      .maybeSingle();
    replyTarget = data ?? null;
  }
  if (!replyTarget?.instantly_email_id) {
    const { data: lastInbound } = await admin
      .from("messages")
      .select("id, instantly_email_id, sender")
      .eq("thread_id", threadId)
      .eq("direction", "inbound")
      .not("instantly_email_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    replyTarget = lastInbound ?? null;
  }
  if (!replyTarget?.instantly_email_id) {
    return NextResponse.json(
      { error: "No inbound Instantly reply found to reply to." },
      { status: 400 },
    );
  }

  const recipientsCsv = (rows?: Array<{ email_address: string }>): string | undefined => {
    if (!rows || rows.length === 0) return undefined;
    return rows.map((r) => r.email_address).join(",");
  };

  // Detect a forward: TO is set AND none of its addresses match the
  // original sender of the inbound being "replied" to. Instantly's
  // sendReply silently ignores TO (it always goes back to the original
  // sender), so for forwards we have to use the standalone /emails send
  // endpoint instead — which accepts an arbitrary TO list.
  const originalSenderLower = replyTarget.sender?.toLowerCase() ?? "";
  const toCsv = recipientsCsv(payload.to);
  const isForward =
    Boolean(toCsv) &&
    payload.to !== undefined &&
    payload.to.length > 0 &&
    !payload.to.some(
      (r) => r.email_address.toLowerCase() === originalSenderLower,
    );

  let newEmailId: string | null = null;
  try {
    const instantly = createInstantlyClient();
    if (isForward) {
      if (!outboundSenderEmail) {
        return NextResponse.json(
          {
            error:
              "Forwarding from an Instantly thread needs a sender mailbox; this thread has none on file.",
          },
          { status: 400 },
        );
      }
      const res = await instantly.sendEmail({
        eaccount: outboundSenderEmail,
        to_address_email_list: toCsv!,
        subject: payload.subject ?? "(forward)",
        body:
          payload.content_type === "html"
            ? { html: payload.body }
            : { text: payload.body },
        cc_address_email_list: recipientsCsv(payload.cc),
        bcc_address_email_list: recipientsCsv(payload.bcc),
      });
      newEmailId = res?.id ?? null;
    } else {
      const res = await instantly.sendReply({
        reply_to_uuid: replyTarget.instantly_email_id,
        subject: payload.subject,
        body:
          payload.content_type === "html"
            ? { html: payload.body }
            : { text: payload.body },
        eaccount: outboundSenderEmail ?? undefined,
        cc_address_email_list: recipientsCsv(payload.cc),
        bcc_address_email_list: recipientsCsv(payload.bcc),
        include_original_body: payload.inject_previous_email_body,
      });
      newEmailId = res?.id ?? null;
    }
  } catch (err) {
    if (err instanceof InstantlyError) {
      console.error("[reply] Instantly error:", {
        status: err.status,
        message: err.message,
        body: err.body,
      });
      const detail =
        typeof err.body === "string"
          ? err.body.slice(0, 500)
          : err.body
            ? JSON.stringify(err.body).slice(0, 500)
            : undefined;
      return NextResponse.json(
        { error: err.message, status: err.status, detail },
        { status: 502 },
      );
    }
    console.error("[reply] Instantly send failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Instantly send failed" },
      { status: 502 },
    );
  }

  // Record the outbound message immediately so the UI updates without
  // waiting for the webhook echo. The eventual `email_sent` webhook (if
  // subscribed) — or the thread backfill on the next inbound — will
  // converge on this row via the matching external_message_id.
  const outboundId = newEmailId
    ? `in:email:${newEmailId}`
    : `in-out:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const recipientsPayload = {
    to: payload.to?.map((r) => r.email_address) ?? [],
    cc: payload.cc?.map((r) => r.email_address) ?? [],
    bcc: payload.bcc?.map((r) => r.email_address) ?? [],
  };
  await admin.from("messages").insert({
    workspace_id: workspaceId,
    thread_id: threadId,
    direction: "outbound",
    source_provider: "instantly",
    sender: outboundSenderEmail,
    recipients: recipientsPayload,
    subject: payload.subject ?? null,
    body_html: payload.content_type === "html" ? payload.body : null,
    body_text:
      payload.content_type === "text"
        ? payload.body
        : payload.body.replace(/<[^>]+>/g, ""),
    sent_at: new Date().toISOString(),
    external_message_id: outboundId,
    instantly_email_id: newEmailId,
  });
  await admin
    .from("threads")
    .update({ needs_reply: false, seen: true })
    .eq("id", threadId);
  await admin
    .from("reply_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("status", "pending");

  return NextResponse.json({ ok: true });
}
