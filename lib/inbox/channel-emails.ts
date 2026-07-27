import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ttlCache } from "@/lib/cache/ttl";
import { loadChannels } from "@/lib/inbox/channels";

// Map of EmailBison channel_id → the most recent outbound sender address.
//
// EmailBison channels store only a friendly display_name ("Nicole
// Collins") — the actual sending address lives on the messages. The
// SenderPicker needs the address to disambiguate channels that share a
// display_name. We derive it from the most recent outbound message per
// channel.
//
// WHY THIS IS ITS OWN CACHED LOADER: this used to run inline in the
// thread-detail page, SERIALLY, AFTER every loader had finished and after
// the "ready to render" mark — an outbound-messages scan (ordered by
// sent_at, limit 1000) on the critical path of every single thread open,
// invisible to the per-loader timing. Now it:
//   1. runs INSIDE the page's Promise.all (parallel with loadThreads etc.),
//      so it no longer adds serially to the response, and
//   2. is ttl-cached per workspace (the address map is workspace-stable —
//      channels and their senders barely change), so most opens pay zero.
async function fetchChannelEmailMap(
  workspaceId: string,
): Promise<Record<string, string>> {
  const channels = await loadChannels(workspaceId);
  const ebChannelIds = channels
    .filter((c) => c.provider === "emailbison" && c.id)
    .map((c) => c.id);
  if (ebChannelIds.length === 0) return {};

  const { data } = await createAdminSupabase()
    .from("messages")
    .select("channel_id, sender")
    .eq("workspace_id", workspaceId)
    .eq("direction", "outbound")
    .in("channel_id", ebChannelIds)
    .not("sender", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1000);

  const map: Record<string, string> = {};
  for (const m of (data ?? []) as Array<{
    channel_id: string;
    sender: string | null;
  }>) {
    if (!m.sender || !m.channel_id) continue;
    if (!(m.channel_id in map)) map[m.channel_id] = m.sender;
  }
  return map;
}

// cache() dedupes within a render; ttlCache() holds the result for 5 min
// across renders/users on the same workspace.
export const loadChannelEmailMap = cache(
  ttlCache(fetchChannelEmailMap, { ttlMs: 5 * 60_000, key: (ws) => ws }),
);
