import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Quick visibility into LinkedIn (Unipile) integration state for the active
// workspace: connected channels, threads, recent messages.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const admin = createAdminSupabase();
  const wsId = session.activeWorkspace.id;

  const [channels, threadCount, messageCount, recentMessages, recentThreads, webhookSubs] = await Promise.all([
    admin
      .from("channels")
      .select("id, type, provider, display_name, status, unipile_account_id, last_synced_at, last_error")
      .eq("workspace_id", wsId)
      .eq("provider", "unipile"),
    admin
      .from("threads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", wsId)
      .not("unipile_chat_id", "is", null),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", wsId)
      .not("unipile_message_id", "is", null),
    admin
      .from("messages")
      .select("id, direction, sender, subject, sent_at, unipile_message_id, thread_id")
      .eq("workspace_id", wsId)
      .not("unipile_message_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(5),
    admin
      .from("threads")
      .select("id, subject, last_message_at, unipile_chat_id, leads:lead_id(full_name, email, linkedin_url)")
      .eq("workspace_id", wsId)
      .not("unipile_chat_id", "is", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(5),
    admin
      .from("webhook_subscriptions")
      .select("id, provider, event_types, target_url, status, last_event_at")
      .eq("workspace_id", wsId)
      .eq("provider", "unipile"),
  ]);

  return NextResponse.json({
    channels: channels.data ?? [],
    counts: {
      threads: threadCount.count ?? 0,
      messages: messageCount.count ?? 0,
    },
    webhook_subscriptions: webhookSubs.data ?? [],
    recent_threads: recentThreads.data ?? [],
    recent_messages: recentMessages.data ?? [],
  });
}
