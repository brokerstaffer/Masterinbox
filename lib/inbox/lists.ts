import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/paginated-select";
import type { ListRow } from "./lists-shared";

export type { ListRow } from "./lists-shared";

async function fetchLists(workspaceId: string): Promise<ListRow[]> {
  const supabase = await createServerSupabase();

  // Pull the lists and the per-client recency aggregate in
  // parallel. The view (migration 0044) returns one row per
  // (workspace, client) with the max sent_at of any INBOUND
  // message landed on that client's threads. Outbound replies
  // don't reshuffle the list — that was the operator's pick.
  const [listsResp, activityResp] = await Promise.all([
    supabase
      .from("lists")
      .select("id, name, icon, sort_order, shared, client_id")
      .eq("workspace_id", workspaceId),
    supabase
      .from("client_inbox_activity")
      .select("client_id, last_inbound_at")
      .eq("workspace_id", workspaceId),
  ]);

  if (listsResp.error) {
    console.error("[loadLists] query failed", listsResp.error);
    return [];
  }
  if (activityResp.error) {
    // Don't fail the whole sidebar if the view query trips — fall
    // back to alphabetical so the page still renders.
    console.error("[loadLists] activity query failed", activityResp.error);
  }

  type ListRowWithClient = ListRow & { client_id: string | null };
  const rows = (listsResp.data ?? []) as ListRowWithClient[];

  const lastInboundByClient = new Map<string, string>();
  for (const a of (activityResp.data ?? []) as Array<{
    client_id: string | null;
    last_inbound_at: string | null;
  }>) {
    if (a.client_id && a.last_inbound_at) {
      lastInboundByClient.set(a.client_id, a.last_inbound_at);
    }
  }

  // Sort: most recent inbound first; lists with no inbound
  // activity drop to the bottom alphabetised (deterministic tail).
  // sort_order is no longer used here — drag-reorder was removed
  // because auto-sort would override any manual move.
  rows.sort((a, b) => {
    const aTs = a.client_id ? lastInboundByClient.get(a.client_id) ?? null : null;
    const bTs = b.client_id ? lastInboundByClient.get(b.client_id) ?? null : null;
    if (aTs && bTs) return aTs < bTs ? 1 : aTs > bTs ? -1 : 0;
    if (aTs) return -1;
    if (bTs) return 1;
    return a.name.localeCompare(b.name);
  });

  // Strip client_id off the wire — ListRow doesn't carry it (it
  // was only needed for the sort) and the consumer is downstream
  // client components that don't need it.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    sort_order: r.sort_order,
    shared: r.shared,
  }));
}

// React.cache only — dedupes within ONE render. No TTL cache
// because the recency the sidebar surfaces changes on every
// inbound webhook reply, and a stale 60s cache would defeat the
// whole feature. The existing realtime-refresher fires
// router.refresh() on `messages` INSERT events so each render
// pulls a fresh ordering within ~250ms of any new reply.
export const loadLists = cache(fetchLists);

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

  // Page past db-max-rows=1000 — see lib/db/paginated-select.ts.
  const threads = await fetchAllRows<{ client_id: string | null }>(({ from, to }) =>
    supabase
      .from("threads")
      .select("client_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .eq("seen", false)
      .range(from, to),
  );

  const unseenByClient = new Map<string, number>();
  for (const t of threads) {
    const cid = t.client_id as string | null;
    if (cid) unseenByClient.set(cid, (unseenByClient.get(cid) ?? 0) + 1);
  }

  const counts: Record<string, number> = {};
  for (const l of clientLists) {
    counts[l.id] = unseenByClient.get(l.client_id) ?? 0;
  }
  return counts;
}
