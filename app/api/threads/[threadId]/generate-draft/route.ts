import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadAgents, loadAgentWithKey, createDraftForAgent } from "@/lib/ai/agent";

// On-demand draft generation: when the user clicks "AI Reply" in the
// composer we pick the first matching active agent (channel + filter)
// and generate a draft. Persists to reply_drafts AND returns the body
// so the composer can update its textarea immediately without waiting
// for the realtime refresh.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  const session = await requireSession();
  const admin = createAdminSupabase();

  const { data: thread } = await admin
    .from("threads")
    .select("id, workspace_id, subject, channel_id, lead_id")
    .eq("id", threadId)
    .eq("workspace_id", session.activeWorkspace.id)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const { data: lastInbound } = await admin
    .from("messages")
    .select("id, sender, subject, body_text, body_html, raw_payload")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastInbound) {
    return NextResponse.json(
      { error: "No inbound message on this thread to draft against." },
      { status: 400 },
    );
  }

  // Find the active agent that matches this thread's channel type.
  // Email-only or both. (LinkedIn wiring follows the same path once
  // Unipile inbound webhooks are flowing.)
  const channelType: "email" | "linkedin" = "email";
  const candidate = (await loadAgents(session.activeWorkspace.id))
    .filter((a) => a.active)
    .filter((a) => a.channel_filter === "both" || a.channel_filter === channelType)
    .filter((a) => {
      if (a.channel_ids.length === 0) return true;
      return thread.channel_id ? a.channel_ids.includes(thread.channel_id) : false;
    })
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];

  if (!candidate) {
    return NextResponse.json(
      { error: "No active Reply Agent matches this thread. Create one in Settings → Reply Agents." },
      { status: 400 },
    );
  }

  const full = await loadAgentWithKey(candidate.id);
  if (!full || !full.api_key) {
    return NextResponse.json(
      { error: `Agent "${candidate.name}" has no API key configured.` },
      { status: 400 },
    );
  }

  // Lead context.
  const { data: lead } = await admin
    .from("leads")
    .select("full_name, email")
    .eq("id", thread.lead_id)
    .maybeSingle();

  const payload = (lastInbound.raw_payload ?? {}) as Record<string, unknown>;
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const senderEmail =
    (data?.sender_email as { email?: string; name?: string } | undefined) ?? undefined;

  const stripHtml = (html: string) =>
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const inboundBody = lastInbound.body_text ?? stripHtml(lastInbound.body_html ?? "");

  const result = await createDraftForAgent({
    workspaceId: session.activeWorkspace.id,
    threadId,
    agent: full,
    leadName: lead?.full_name ?? null,
    leadEmail: lead?.email ?? null,
    ourName: senderEmail?.name ?? null,
    ourEmail: senderEmail?.email ?? null,
    subject: lastInbound.subject ?? thread.subject,
    inboundBody,
  });

  switch (result.status) {
    case "ok":
      return NextResponse.json({
        draft_id: result.draftId,
        agent_id: candidate.id,
        agent_name: candidate.name,
        body: result.body,
      });
    case "no_key":
      return NextResponse.json(
        { error: `Agent "${candidate.name}" has no API key configured.` },
        { status: 400 },
      );
    case "insert_failed":
      return NextResponse.json(
        { error: `Could not save draft: ${result.error}` },
        { status: 500 },
      );
    case "ai_failed":
      return NextResponse.json(
        { error: `Provider error: ${result.error}` },
        { status: 502 },
      );
  }
}
