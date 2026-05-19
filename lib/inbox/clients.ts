import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export interface ClientOption {
  id: string;
  name: string;
  slug: string;
}

// Returns every client row that has at least one thread in this workspace,
// sorted by name. Used by the FilterBuilder's "Clients" picker. Cheap —
// the clients table is a fixed catalog of ~24 rows in Corofy's singleton
// setup. We still inner-join to threads so the picker only surfaces clients
// the user can actually filter by (skips inactive seeded rows).
export const loadClients = cache(async function loadClients(
  workspaceId: string,
): Promise<ClientOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("threads")
    .select("client_id, clients:client_id(id, name, slug)")
    .eq("workspace_id", workspaceId)
    .not("client_id", "is", null);
  if (error || !data) return [];

  const seen = new Map<string, ClientOption>();
  for (const row of data) {
    const c = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    if (!c?.id) continue;
    if (seen.has(c.id)) continue;
    seen.set(c.id, {
      id: c.id as string,
      name: c.name as string,
      slug: c.slug as string,
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
});
