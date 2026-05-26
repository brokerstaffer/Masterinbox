import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { ttlCache } from "@/lib/cache/ttl";
import type { ChannelRow } from "./channels-shared";

export type { ChannelRow } from "./channels-shared";

async function fetchChannels(workspaceId: string): Promise<ChannelRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("channels")
    .select("id, display_name, provider, type")
    .eq("workspace_id", workspaceId)
    .order("display_name", { ascending: true });

  if (error) {
    console.error("[loadChannels] query failed", error);
    return [];
  }
  return (data ?? []) as ChannelRow[];
}

// Channels turn over only when sender accounts are added/removed (rare),
// so caching for 60s across all concurrent users is safe.
export const loadChannels = cache(ttlCache(fetchChannels, { ttlMs: 60_000 }));
