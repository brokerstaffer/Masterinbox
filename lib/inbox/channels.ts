import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ChannelRow } from "./channels-shared";

export type { ChannelRow } from "./channels-shared";

export const loadChannels = cache(async function loadChannels(
  workspaceId: string,
): Promise<ChannelRow[]> {
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
});
