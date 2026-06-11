import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink, Workflow, UserCheck, Ban, Users } from "lucide-react";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  loadPipelineEntries,
  loadPortalCounts,
  loadTeamMembers,
  resolveStageLabels,
  visibleStagesFor,
} from "@/lib/portals/portal-data";
import { publicPortalUrl } from "@/lib/portals/public-url";
import {
  PipelineHeader,
  PipelineFooterInfo,
} from "@/components/portals/pipeline-header";
import { PipelineBoard } from "@/components/portals/pipeline-board";
import {
  StageLabelsProvider,
  VisibleStagesProvider,
} from "@/components/portals/stage-labels-context";
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
  // Defensive read: try with feature_flags first, fall back to the
  // original column set if the column doesn't exist yet (migration
  // 0053 not applied). Same shape as resolvePortalClient — keeps
  // the staff drilldown working even in a mid-deploy state.
  const SELECT_WITH_FLAGS =
    "id, name, slug, portal_token, portal_enabled, stage_label_overrides, fub_api_key, feature_flags";
  const SELECT_BASE =
    "id, name, slug, portal_token, portal_enabled, stage_label_overrides, fub_api_key";
  const firstAttempt = await admin
    .from("clients")
    .select(SELECT_WITH_FLAGS)
    .eq("id", clientId)
    .maybeSingle();
  let client = firstAttempt.data;
  if (firstAttempt.error) {
    const msg = (firstAttempt.error.message ?? "").toLowerCase();
    const missingColumn =
      firstAttempt.error.code === "42703" ||
      msg.includes('column "feature_flags"') ||
      msg.includes("column feature_flags") ||
      (msg.includes("feature_flags") && msg.includes("does not exist"));
    if (missingColumn) {
      const retry = await admin
        .from("clients")
        .select(SELECT_BASE)
        .eq("id", clientId)
        .maybeSingle();
      client = retry.data
        ? ({ ...retry.data, feature_flags: {} } as typeof client)
        : null;
    }
  }
  if (!client || client.slug === "unknown") notFound();

  const [entries, counts, teamMembers] = await Promise.all([
    loadPipelineEntries(client.id as string),
    loadPortalCounts(client.id as string),
    loadTeamMembers(client.id as string),
  ]);
  // "Open live portal" must point at the brokerage-facing custom
  // domain so staff click-throughs land on the same URL clients see.
  const portalPublicUrl = publicPortalUrl(client.portal_token as string | null);

  // Mirror the client's per-stage label overrides on the staff view
  // so what the broker sees and what staff sees can never drift.
  const rawOverrides = client.stage_label_overrides;
  const overrides: Record<string, unknown> =
    rawOverrides && typeof rawOverrides === "object"
      ? (rawOverrides as Record<string, unknown>)
      : {};
  const stageLabels = resolveStageLabels(overrides);
  // Mirror the per-client visible stages on the staff drilldown so
  // staff see the same column/filter set the client sees on their
  // own portal — no risk of drift.
  const rawFlags = (client as { feature_flags?: unknown }).feature_flags;
  const featureFlags: Record<string, unknown> =
    rawFlags && typeof rawFlags === "object" && !Array.isArray(rawFlags)
      ? (rawFlags as Record<string, unknown>)
      : {};
  const visibleStages = visibleStagesFor({ feature_flags: featureFlags });

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
        {portalPublicUrl ? (
          <a
            href={portalPublicUrl}
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
        <StageLabelsProvider value={stageLabels}>
          <VisibleStagesProvider value={visibleStages}>
            <PipelineHeader clientName={client.name as string} />
            {client.portal_token ? (
              <>
                <PipelineBoard
                  token={client.portal_token as string}
                  entries={entries}
                  teamMembers={teamMembers}
                  stageLabels={stageLabels}
                  stageLabelOverrides={overrides}
                  fubConnected={Boolean(
                    (client as { fub_api_key?: string | null }).fub_api_key,
                  )}
                />
                <PipelineFooterInfo />
              </>
            ) : (
              <div className="mx-auto max-w-6xl px-6 py-12 text-center text-sm text-muted-foreground">
                This client has no portal token yet; pipeline edits aren&apos;t wired up.
              </div>
            )}
          </VisibleStagesProvider>
        </StageLabelsProvider>
      </div>
    </div>
  );
}
