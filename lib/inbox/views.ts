import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export type { CustomView } from "./views-shared";
export { slugifyView } from "./views-shared";

import type { CustomView } from "./views-shared";
import { slugifyView } from "./views-shared";

// Wrapped with React.cache so concurrent calls with the same workspaceId
// within one render share a single Supabase round-trip. The thread-detail
// page calls loadViewBySlug both directly (for filter resolution) and
// indirectly via loadThreads's inner view-preset lookup. Without cache(),
// that's 2 round-trips × ~280ms each — pure waste.
export const loadViews = cache(async function loadViews(
  workspaceId: string,
): Promise<CustomView[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("custom_views")
    .select("id, name, icon, filter_json, sort_order, is_system")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[loadViews] query failed", error);
    return [];
  }

  return (data ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
    slug: slugifyView(v.name as string),
    icon: (v.icon ?? null) as string | null,
    filter_json: (v.filter_json ?? {}) as Record<string, unknown>,
    sort_order: v.sort_order as number,
    is_system: v.is_system as boolean,
  }));
});

// Resolve a URL slug to its CustomView. Returns null if the slug doesn't
// match any view in the workspace. Sidebar items (archive/spam/trash) are
// NOT custom_views — callers handle those separately.
export const loadViewBySlug = cache(async function loadViewBySlug(
  workspaceId: string,
  slug: string,
): Promise<CustomView | null> {
  const views = await loadViews(workspaceId);
  return views.find((v) => v.slug === slug) ?? null;
});

interface FilterRowLite {
  field?: string;
  value?: unknown;
}

// Computes the "N new" count for each tab in the TabBar. "New" =
// unseen open threads matching the view's filter — same definition the
// blue dot on the thread list uses.
//
// Strategy:
//   - One head-only count gives total unseen open (drives the "All" pill).
//   - One join query gives every (label_id, thread_id) pair where the
//     thread is open + unseen; we bucket by label_id in JS.
//   - For each view, pick the label_id out of its filter_json and look up
//     the count. Views with no filter rows → total. Views with other
//     filter shapes get 0 for now.
export const loadViewCounts = cache(async function loadViewCounts(
  workspaceId: string,
): Promise<Record<string, number>> {
  const supabase = await createServerSupabase();
  const views = await loadViews(workspaceId);

  const totalReq = supabase
    .from("threads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .eq("seen", false);

  const labelsReq = supabase
    .from("label_assignments")
    .select("label_id, threads!inner(id, status, seen, workspace_id)")
    .eq("workspace_id", workspaceId)
    .eq("target_type", "thread")
    .eq("threads.status", "open")
    .eq("threads.seen", false);

  const [totalRes, labelsRes] = await Promise.all([totalReq, labelsReq]);

  const total = totalRes.count ?? 0;
  const unseenByLabel = new Map<string, Set<string>>();
  for (const row of labelsRes.data ?? []) {
    const r = row as {
      label_id: string;
      threads: { id: string } | { id: string }[] | null;
    };
    const thread = Array.isArray(r.threads) ? r.threads[0] : r.threads;
    if (!thread?.id) continue;
    const set = unseenByLabel.get(r.label_id) ?? new Set<string>();
    set.add(thread.id);
    unseenByLabel.set(r.label_id, set);
  }

  const counts: Record<string, number> = {};
  for (const v of views) {
    const rows = ((v.filter_json as { rows?: FilterRowLite[] } | null)?.rows) ?? [];
    if (rows.length === 0) {
      counts[v.id] = total;
      continue;
    }
    const labelsRow = rows.find((r) => r?.field === "labels");
    if (labelsRow && Array.isArray(labelsRow.value)) {
      const labelIds = labelsRow.value as string[];
      const ids = new Set<string>();
      for (const lid of labelIds) {
        const set = unseenByLabel.get(lid);
        if (set) for (const id of set) ids.add(id);
      }
      counts[v.id] = ids.size;
      continue;
    }
    counts[v.id] = 0;
  }
  return counts;
});
