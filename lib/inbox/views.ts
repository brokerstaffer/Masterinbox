import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  OPEN_RESPONSES_PRESET,
  openResponsesThreadIds,
} from "@/lib/inbox/open-responses";

export type { CustomView } from "./views-shared";
export { slugifyView } from "./views-shared";

import type { CustomView } from "./views-shared";
import { slugifyView } from "./views-shared";

// React.cache dedupes within ONE render (when several server components
// need the views list during the same request, the query runs once).
//
// We dropped the 30s cross-request ttlCache because Railway can scale
// to multiple Node workers and the cache is in-memory per-worker — an
// invalidate() call after a drag PATCH would only clear the cache on
// whichever worker handled the PATCH. The next request could land on a
// different worker still holding the stale 30s window, and the user
// would see the dragged tab snap back. Views queries are small (~10
// rows) so the cost of refetching per request is negligible.
async function fetchViews(workspaceId: string): Promise<CustomView[]> {
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
}

export const loadViews = cache(fetchViews);

// Kept as a no-op so existing mutation routes can call it without
// caring whether a TTL cache is in play. If we re-introduce
// cross-request caching for views later (e.g. via Redis) the
// implementation re-attaches here without touching every caller.
export function invalidateViewsCache(_workspaceId?: string) {
  /* no-op — see fetchViews comment above */
}

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
  //
  // CHUNK was 500 — that built a PostgREST URL with `target_id=in.(uuid1,
  // …,uuid500)` totalling ~18KB which Node's default fetch (16KB header
  // cap) couldn't handle, producing a silent 7-second retry per page
  // render. 150 matches the safer cap used in lib/inbox/open-responses.ts
  // and keeps every chunk URL under ~6KB.
  //
  // The chunks are independent — fire them in parallel via Promise.all
  // instead of awaiting sequentially. With 465 threads → 4 chunks ×
  // ~80ms each, totalling 80ms instead of 320ms.
  const byLabel = new Map<string, { all: Set<string>; unseen: Set<string> }>();
  const CHUNK = 150;
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) slices.push(ids.slice(i, i + CHUNK));
  const chunkResults = await Promise.all(
    slices.map((slice) =>
      supabase
        .from("label_assignments")
        .select("label_id, target_id")
        .eq("workspace_id", workspaceId)
        .eq("target_type", "thread")
        .in("target_id", slice)
        .range(0, 49_999),
    ),
  );
  for (const { data: assignments } of chunkResults) {
    for (const row of assignments ?? []) {
      const r = row as { label_id: string; target_id: string };
      const bucket = byLabel.get(r.label_id) ?? { all: new Set(), unseen: new Set() };
      bucket.all.add(r.target_id);
      if (unseenSet.has(r.target_id)) bucket.unseen.add(r.target_id);
      byLabel.set(r.label_id, bucket);
    }
  }

  // For the "Open Responses" view we now have to know which thread's
  // last message was inbound — that's only knowable after a per-thread
  // message lookup, which `openResponsesThreadIds` already does. Reuse
  // that helper so the count pass and the visible-list pass can never
  // disagree about who belongs.
  const openResponseSet = views.some(
    (v) => (v.filter_json as { preset?: string } | null)?.preset === OPEN_RESPONSES_PRESET,
  )
    ? await openResponsesThreadIds(supabase, workspaceId)
    : new Set<string>();

  const counts: Record<string, ViewCount> = {};
  for (const v of views) {
    const preset = (v.filter_json as { preset?: string } | null)?.preset;
    if (preset === OPEN_RESPONSES_PRESET) {
      // Intersect with the current list-scoped page of threads. When
      // the sidebar has a client list active, that limits totalOpen
      // and the `%` shown in the pill follows. The helper itself isn't
      // list-scoped, so we filter by membership here.
      const all = new Set<string>();
      const unseen = new Set<string>();
      for (const t of threadRows) {
        if (!openResponseSet.has(t.id)) continue;
        all.add(t.id);
        if (unseenSet.has(t.id)) unseen.add(t.id);
      }
      counts[v.id] = {
        unseen: unseen.size,
        pct: totalOpen > 0 ? Math.round((all.size / totalOpen) * 100) : 0,
      };
      continue;
    }
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
