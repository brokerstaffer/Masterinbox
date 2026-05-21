import type { Metadata } from "next";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadClientIntroLeads } from "@/lib/portals/intro-leads";
import { computePortalMetrics } from "@/lib/portals/metrics";
import { ClientPortalView } from "@/components/portals/client-portal";
import { PortalLogo } from "@/components/portals/portal-logo";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";

// Public, login-free client portal. The token in the path IS the
// credential — the proxy.ts middleware lets /portal/* through without a
// session. Every query here goes through the service-role admin client,
// scoped by the resolved client_id (see lib/portals/intro-leads.ts).
export const dynamic = "force-dynamic";

async function resolveClient(token: string) {
  // Feature-flagged off → resolve nothing (skips the portal_* columns
  // that migration 0016 may not have created on this environment yet).
  if (!CLIENT_PORTALS_ENABLED) return null;
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("clients")
    .select("id, name, slug, portal_enabled")
    .eq("portal_token", token)
    .maybeSingle();
  if (!data || data.slug === "unknown") return null;
  if (data.portal_enabled === false) return null;
  return { id: data.id as string, name: data.name as string };
}

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolveClient(token);
  return {
    title: client ? `${client.name} — Introductions Portal` : "Portal not found",
    robots: { index: false, follow: false }, // never index a secret URL
  };
}

export default async function PortalPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolveClient(token);

  if (!client) return <PortalNotFound />;

  const leads = await loadClientIntroLeads(client.id);
  const metrics = computePortalMetrics(leads, 12);

  return <ClientPortalView clientName={client.name} leads={leads} metrics={metrics} />;
}

function PortalNotFound() {
  return (
    <div className="min-h-screen bg-[#f4f7fb] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <PortalLogo className="size-14 mx-auto" />
        <h1 className="mt-5 text-lg font-semibold text-[#15181e]">
          Portal not found
        </h1>
        <p className="mt-1.5 text-sm text-[#5b6370]">
          This portal link is invalid or has been turned off. Please check the
          link, or contact Corofy for an updated one.
        </p>
      </div>
    </div>
  );
}
