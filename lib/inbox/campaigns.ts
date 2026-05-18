import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export interface CampaignOption {
  id: string;          // campaign_id text (EB numeric id or Instantly uuid)
  name: string;        // human-readable name from the provider
  source: "emailbison" | "instantly" | "unipile" | null;
}

// Returns the distinct list of (campaign_id, campaign_name, source_provider)
// triples present on threads in this workspace, sorted by name. Drives the
// "Campaigns" picker in the FilterBuilder. Cheap: there are typically tens to
// low hundreds of campaigns per workspace, and the index on threads
// (workspace_id, campaign_id) keeps the distinct scan fast.
export const loadCampaigns = cache(async function loadCampaigns(
  workspaceId: string,
): Promise<CampaignOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("threads")
    .select("campaign_id, campaign_name, source_provider")
    .eq("workspace_id", workspaceId)
    .not("campaign_id", "is", null);
  if (error || !data) return [];

  const seen = new Map<string, CampaignOption>();
  for (const row of data) {
    const id = row.campaign_id as string | null;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name: (row.campaign_name as string | null) ?? id,
      source: (row.source_provider as CampaignOption["source"]) ?? null,
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
});
