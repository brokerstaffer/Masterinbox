import { createAdminSupabase } from "@/lib/supabase/admin";

// Maps a campaign name (e.g. "Brooklyn Group (2) - The Arc New Rochelle (copy)")
// to the matching Corofy client (e.g. "Brooklyn Group"). Falls back to the
// "Unknown" client when nothing matches.
//
// Matching rules:
//   - Case-insensitive SUBSTRING scan over each client's `name` PLUS every
//     entry in its `aliases` array (admin-managed via /settings/clients).
//   - The LONGEST matching needle wins, so a longer/more-specific alias
//     beats a shorter generic one (prevents "Howard Hanna" from claiming
//     a thread that actually belongs to "Howard Hanna NYC").
//   - Single in-memory cache keyed by slug, 5-minute TTL — clients change
//     rarely, and webhooks should not hammer Supabase for the catalog.

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
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
    .select("id, name, slug, aliases");
  if (error || !data) {
    console.error("[clients] failed to load clients table", error);
    return cache?.rows ?? [];
  }
  const rows: ClientRow[] = data.map((d) => ({
    id: d.id as string,
    name: d.name as string,
    slug: d.slug as string,
    aliases: (d.aliases as string[] | null) ?? [],
  }));
  cache = { rows, loadedAt: Date.now() };
  return rows;
}

export async function deriveClientIdFromCampaign(
  campaignName: string | null | undefined,
): Promise<string | null> {
  const rows = await loadClients();
  if (rows.length === 0) return null;

  // Always-resolvable fallback when nothing matches.
  const unknown = rows.find((r) => r.slug === "unknown") ?? null;

  if (!campaignName) return unknown?.id ?? null;
  const haystack = campaignName.toLowerCase();

  // Exclude "Unknown" from the match scan — it's the fallback, not a target.
  const candidates = rows.filter((r) => r.slug !== "unknown");

  let bestClient: ClientRow | null = null;
  let bestLength = 0;
  for (const c of candidates) {
    const needles: string[] = [c.name, ...(c.aliases ?? [])];
    for (const raw of needles) {
      const needle = raw?.toLowerCase().trim();
      if (!needle) continue;
      if (!haystack.includes(needle)) continue;
      if (needle.length > bestLength) {
        bestClient = c;
        bestLength = needle.length;
      }
    }
  }
  if (bestClient) return bestClient.id;
  return unknown?.id ?? null;
}

// Bypass the cache. Called after add/edit/delete on the clients table
// so the next webhook sees fresh data instead of waiting 5 minutes.
export function _invalidateClientCache(): void {
  cache = null;
}
