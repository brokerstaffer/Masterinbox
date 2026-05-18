import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ListRow } from "./lists-shared";

export type { ListRow } from "./lists-shared";

export const loadLists = cache(async function loadLists(
  workspaceId: string,
): Promise<ListRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("lists")
    .select("id, name, icon, sort_order, shared")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[loadLists] query failed", error);
    return [];
  }
  return (data ?? []) as ListRow[];
});

export async function loadListCounts(workspaceId: string): Promise<Map<string, number>> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("thread_list_items")
    .select("list_id")
    .eq("workspace_id", workspaceId);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const k = row.list_id as string;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
