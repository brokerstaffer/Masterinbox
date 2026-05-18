import { createServerSupabase } from "@/lib/supabase/server";

export type { CustomView } from "./views-shared";
export { slugifyView } from "./views-shared";

import type { CustomView } from "./views-shared";
import { slugifyView } from "./views-shared";

export async function loadViews(workspaceId: string): Promise<CustomView[]> {
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

// Resolve a URL slug to its CustomView. Returns null if the slug doesn't
// match any view in the workspace. Sidebar items (archive/spam/trash) are
// NOT custom_views — callers handle those separately.
export async function loadViewBySlug(
  workspaceId: string,
  slug: string,
): Promise<CustomView | null> {
  const views = await loadViews(workspaceId);
  return views.find((v) => v.slug === slug) ?? null;
}
