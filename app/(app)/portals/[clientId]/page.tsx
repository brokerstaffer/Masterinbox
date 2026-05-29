import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink, Workflow, UserCheck, Ban, Users } from "lucide-react";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadPipelineEntries, loadPortalCounts } from "@/lib/portals/portal-data";
import { PipelineHeader } from "@/components/portals/pipeline-header";
import { PipelineBoard } from "@/components/portals/pipeline-board";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";
import { PortalsComingSoon } from "@/components/portals/portals-coming-soon";

// Internal drill-down — staff view of one client's Recruiting Pipeline.
// Renders the same pipeline surface the public portal uses so what staff
// see and what the client sees can never drift. Admin edits go through
// the same token-based routes (the token is in the URL we pass down).
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

  const [entries, counts] = await Promise.all([
    loadPipelineEntries(client.id as string),
    loadPortalCounts(client.id as string),
  ]);
  const portalPath = client.portal_token ? `/portal/${client.portal_token}` : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#f6f7f9]">
      {/* Slim admin bar above the embedded pipeline */}
      <div className="shrink-0 border-b bg-white px-6 h-12 flex items-center justify-between gap-4">
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
        <PipelineHeader clientName={client.name as string} />
        {client.portal_token ? (
          <PipelineBoard token={client.portal_token as string} entries={entries} />
        ) : (
          <div className="mx-auto max-w-6xl px-6 py-12 text-center text-sm text-muted-foreground">
            This client has no portal token yet; pipeline edits aren&apos;t wired up.
          </div>
        )}
      </div>
    </div>
  );
}
