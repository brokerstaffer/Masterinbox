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

// Per-list count of UNSEEN open threads — drives the "N new" pill on each
// client in the sidebar. Keyed by list id. Returns a plain object (not a
// Map) so it serialises across the server→client component boundary.
//
// These lists are client-backed (lists.client_id set), so a list's unseen
// count is just its client's unseen open-thread count.
export async function loadListUnseenCounts(
  workspaceId: string,
): Promise<Record<string, number>> {
  const supabase = await createServerSupabase();
  const { data: lists } = await supabase
    .from("lists")
    .select("id, client_id")
    .eq("workspace_id", workspaceId);
  const clientLists = (lists ?? []).filter(
    (l) => l.client_id,
  ) as Array<{ id: string; client_id: string }>;
  if (clientLists.length === 0) return {};

  const { data: threads } = await supabase
    .from("threads")
    .select("client_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .eq("seen", false)
    .range(0, 49_999);

  const unseenByClient = new Map<string, number>();
  for (const t of threads ?? []) {
    const cid = t.client_id as string | null;
    if (cid) unseenByClient.set(cid, (unseenByClient.get(cid) ?? 0) + 1);
  }

  const counts: Record<string, number> = {};
  for (const l of clientLists) {
    counts[l.id] = unseenByClient.get(l.client_id) ?? 0;
  }
  return counts;
}
