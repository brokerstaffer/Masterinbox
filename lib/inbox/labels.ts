import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import type { LabelRow } from "./labels-shared";

export type { LabelRow } from "./labels-shared";

// React.cache memoizes per request — page-level Promise.all and any
// downstream caller share the same Supabase round-trip.
export const loadLabels = cache(async function loadLabels(
  workspaceId: string,
): Promise<LabelRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("labels")
    .select(
      "id, name, color, sentiment, platform, obligation, mirror_to_emailbison, sort_order, is_system",
    )
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[loadLabels] query failed", error);
    return [];
  }
  return (data ?? []) as LabelRow[];
});
