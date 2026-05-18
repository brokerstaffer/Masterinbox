import { createAdminSupabase } from "@/lib/supabase/admin";

// Maps a campaign name (e.g. "Brooklyn Group (2) - The Arc New Rochelle (copy)")
// to the matching Corofy client (e.g. "Brooklyn Group"). Falls back to the
// "Unknown" client when no name matches.
//
// Matching rules:
//   - case-insensitive substring scan over the seeded client.name values
//   - the LONGEST matching name wins (so "Howard Hanna NYC" beats a campaign
//     that happens to also contain "Howard Hanna")
//   - a single in-memory cache of clients keyed by slug, refreshed lazily on
//     a 5-minute TTL — clients change rarely so this avoids per-webhook
//     Supabase reads. The serverless cold-start invalidates the cache for
//     free; long-lived processes get the TTL refresh.

interface ClientRow {
  id: string;
  name: string;
  slug: string;
}

let cache: { rows: ClientRow[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadClients(): Promise<ClientRow[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.rows;
  }
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, slug");
  if (error || !data) {
    console.error("[clients] failed to load clients table", error);
    return cache?.rows ?? [];
  }
  cache = { rows: data, loadedAt: Date.now() };
  return data;
}

export async function deriveClientIdFromCampaign(
  campaignName: string | null | undefined,
): Promise<string | null> {
  const rows = await loadClients();
  if (rows.length === 0) return null;

  // Always resolvable fallback. Returned when no real client matches.
  const unknown = rows.find((r) => r.slug === "unknown") ?? null;

  if (!campaignName) return unknown?.id ?? null;
  const haystack = campaignName.toLowerCase();

  // Exclude "Unknown" from the match scan — it's the fallback, not a target.
  const candidates = rows.filter((r) => r.slug !== "unknown");

  let best: ClientRow | null = null;
  for (const c of candidates) {
    const needle = c.name.toLowerCase();
    if (!needle || !haystack.includes(needle)) continue;
    if (!best || c.name.length > best.name.length) best = c;
  }
  if (best) return best.id;
  return unknown?.id ?? null;
}

// Bypass the cache. Useful for tests or after a fresh seed.
export function _invalidateClientCache(): void {
  cache = null;
}
