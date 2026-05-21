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

export interface ViewCount {
  unseen: number; // drives the "N new" pill
  // Share of all open threads that carry this view's label. null for
  // views that aren't a single-label filter (e.g. "All Email").
  pct: number | null;
}

// Computes, per TabBar view: the "N new" unseen count AND the percentage
// of all open threads carrying that view's label ("40% Interested" etc.).
//
// One pass over every OPEN thread (id + seen) + its label assignments
// lets us derive both — total-per-label for the %, unseen-per-label for
// the pill. `listId` narrows everything to one client when a sidebar
// list is active.
export const loadViewCounts = cache(async function loadViewCounts(
  workspaceId: string,
  listId?: string | null,
): Promise<Record<string, ViewCount>> {
  const supabase = await createServerSupabase();
  const views = await loadViews(workspaceId);

  let listClientId: string | null = null;
  if (listId) {
    const { data: listRow } = await supabase
      .from("lists")
      .select("client_id")
      .eq("id", listId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    listClientId = (listRow?.client_id as string | null) ?? null;
  }

  // Every OPEN thread with its seen flag (range defeats the implicit
  // 1000-row cap).
  let threadReq = supabase
    .from("threads")
    .select("id, seen")
    .eq("workspace_id", workspaceId)
    .eq("status", "open");
  if (listClientId) threadReq = threadReq.eq("client_id", listClientId);
  const threadRes = await threadReq.range(0, 49_999);
  const threadRows = (threadRes.data ?? []) as Array<{ id: string; seen: boolean }>;
  const totalOpen = threadRows.length;
  const ids = threadRows.map((t) => t.id);
  const unseenSet = new Set(threadRows.filter((t) => !t.seen).map((t) => t.id));
  const totalUnseen = unseenSet.size;

  // label_id → { all threads, unseen threads }
  const byLabel = new Map<string, { all: Set<string>; unseen: Set<string> }>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: assignments } = await supabase
      .from("label_assignments")
      .select("label_id, target_id")
      .eq("workspace_id", workspaceId)
      .eq("target_type", "thread")
      .in("target_id", slice)
      .range(0, 49_999);
    for (const row of assignments ?? []) {
      const r = row as { label_id: string; target_id: string };
      const bucket = byLabel.get(r.label_id) ?? { all: new Set(), unseen: new Set() };
      bucket.all.add(r.target_id);
      if (unseenSet.has(r.target_id)) bucket.unseen.add(r.target_id);
      byLabel.set(r.label_id, bucket);
    }
  }

  const counts: Record<string, ViewCount> = {};
  for (const v of views) {
    const rows = ((v.filter_json as { rows?: FilterRowLite[] } | null)?.rows) ?? [];
    if (rows.length === 0) {
      // "All Email" — show the unseen count, no % (it's the whole 100%).
      counts[v.id] = { unseen: totalUnseen, pct: null };
      continue;
    }
    const labelsRow = rows.find((r) => r?.field === "labels");
    if (labelsRow && Array.isArray(labelsRow.value)) {
      const labelIds = labelsRow.value as string[];
      const allIds = new Set<string>();
      const unseenIds = new Set<string>();
      for (const lid of labelIds) {
        const bucket = byLabel.get(lid);
        if (!bucket) continue;
        for (const id of bucket.all) allIds.add(id);
        for (const id of bucket.unseen) unseenIds.add(id);
      }
      counts[v.id] = {
        unseen: unseenIds.size,
        pct: totalOpen > 0 ? Math.round((allIds.size / totalOpen) * 100) : 0,
      };
      continue;
    }
    counts[v.id] = { unseen: 0, pct: null };
  }
  return counts;
});
