import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadIntroSummaryByClient } from "@/lib/portals/intro-leads";
import { PortalsAdmin } from "@/components/portals/portals-admin";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";
import { PortalsComingSoon } from "@/components/portals/portals-coming-soon";

// Internal admin page — lists every client with its Introduction count and
// the controls to manage that client's public portal URL. Reached from the
// icon-rail "Client Portals" button.
export const dynamic = "force-dynamic";

export interface PortalClientRow {
  id: string;
  name: string;
  slug: string;
  portal_token: string | null;
  portal_enabled: boolean;
  intro_count: number;
  last_intro_at: string | null;
}

export default async function PortalsPage() {
  await requireSession();

  // Feature-flagged off → show the placeholder and skip every query that
  // touches the portal_* columns (migration 0016 may not be applied yet).
  if (!CLIENT_PORTALS_ENABLED) return <PortalsComingSoon />;

  const admin = createAdminSupabase();
  const [{ data: clients }, summary] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, slug, portal_token, portal_enabled")
      .neq("slug", "unknown")
      .order("name", { ascending: true }),
    loadIntroSummaryByClient(),
  ]);

  const rows: PortalClientRow[] = (clients ?? []).map((c) => {
    const s = summary.get(c.id as string);
    return {
      id: c.id as string,
      name: c.name as string,
      slug: c.slug as string,
      portal_token: (c.portal_token as string | null) ?? null,
      portal_enabled: (c.portal_enabled as boolean | null) ?? true,
      intro_count: s?.count ?? 0,
      last_intro_at: s?.lastAt ?? null,
    };
  });

  return <PortalsAdmin rows={rows} />;
}
