import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink, Workflow, UserCheck, Ban, Users } from "lucide-react";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadCombinedClientIntroLeads } from "@/lib/portals/intro-leads";
import { computePortalMetrics } from "@/lib/portals/metrics";
import { loadPortalCounts } from "@/lib/portals/portal-data";
import { ClientPortalView } from "@/components/portals/client-portal";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";
import { PortalsComingSoon } from "@/components/portals/portals-coming-soon";

// Internal drill-down — staff view of one client's Introduction leads.
// Renders the exact same component the public portal uses (adminPreview
// mode) so what staff see and what the client sees can never drift.
export const dynamic = "force-dynamic";

export default async function PortalDrilldownPage(props: {
  params: Promise<{ clientId: string }>;
}) {
  await requireSession();
  if (!CLIENT_PORTALS_ENABLED) return <PortalsComingSoon />;
  const { clientId } = await props.params;

  const admin = createAdminSupabase();
  const { data: client } = await admin
    .from("clients")
    .select("id, name, slug, portal_token, portal_enabled")
    .eq("id", clientId)
    .maybeSingle();
  if (!client || client.slug === "unknown") notFound();

  const [leads, counts] = await Promise.all([
    loadCombinedClientIntroLeads(client.id as string),
    loadPortalCounts(client.id as string),
  ]);
  const metrics = computePortalMetrics(leads, 12);
  const portalPath = client.portal_token ? `/portal/${client.portal_token}` : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Slim admin bar above the embedded portal preview */}
      <div className="shrink-0 border-b bg-background px-6 h-12 flex items-center justify-between gap-4">
        <Link
          href="/portals"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          All client portals
        </Link>
        <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Workflow className="size-3.5" />
            {counts.pipeline} in pipeline
          </span>
          <span className="inline-flex items-center gap-1.5">
            <UserCheck className="size-3.5" />
            {counts.agents} agents
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Ban className="size-3.5" />
            {counts.dnc} DNC
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" />
            {counts.team} team
          </span>
        </div>
        {portalPath ? (
          <a
            href={portalPath}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1565C0] hover:underline"
          >
            Open live portal
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        <ClientPortalView
          clientName={client.name as string}
          leads={leads}
          metrics={metrics}
          adminPreview
        />
      </div>
    </div>
  );
}
