import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/portals/token";
import {
  loadPipelineEntries,
  loadTeamMembers,
  resolveStageLabels,
  safeStageLabelsFor,
  visibleStagesFor,
} from "@/lib/portals/portal-data";
import {
  PipelineHeader,
  PipelineFooterInfo,
} from "@/components/portals/pipeline-header";
import { PipelineBoard } from "@/components/portals/pipeline-board";
import { PortalLogo } from "@/components/portals/portal-logo";
import { WelcomeRedirect } from "@/components/portals/welcome-redirect";
import {
  StageLabelsProvider,
  VisibleStagesProvider,
} from "@/components/portals/stage-labels-context";

// The Recruiting Pipeline IS the portal home now. Every Introduction
// (legacy MasterInbox feed + new Postgres-triggered label assignments)
// lands as a client_pipeline_entries row — see migration 0027 — so this
// page renders the full lead list with stage management, notes, and the
// "needs replacement" toggle in one place. The old standalone
// /pipeline subroute redirects here.

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client
      ? `${client.name} — Recruiting Pipeline`
      : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function PortalRoot(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) return <PortalNotFound />;

  const [entries, teamMembers] = await Promise.all([
    loadPipelineEntries(client.id),
    loadTeamMembers(client.id),
  ]);

  const fullLabels = resolveStageLabels(client.stage_label_overrides);
  // Per-client visible stage list. Real clients get the canonical
  // 8 stages; flag-enabled clients (OpsLabs) get the additional
  // interview_scheduled tile. Computed server-side and shared
  // across every nested component via VisibleStagesProvider.
  const visibleStages = visibleStagesFor(client);
  // safeStageLabelsFor masks hidden stages' human labels with the
  // raw enum key BEFORE the prop crosses the server→client boundary,
  // so real clients' View Source never carries "Interview Scheduled"
  // in the SSR hydration payload. OpsLabs (with the flag) gets the
  // full labels through.
  const stageLabels = safeStageLabelsFor(fullLabels, visibleStages);

  return (
    <StageLabelsProvider value={stageLabels}>
      <VisibleStagesProvider value={visibleStages}>
        <WelcomeRedirect token={token} />
        <PipelineHeader clientName={client.name} />
        <PipelineBoard
          token={token}
          entries={entries}
          teamMembers={teamMembers}
          stageLabels={stageLabels}
          stageLabelOverrides={client.stage_label_overrides}
          fubConnected={client.fub_api_key_set}
        />
        <PipelineFooterInfo />
      </VisibleStagesProvider>
    </StageLabelsProvider>
  );
}

function PortalNotFound() {
  return (
    <div className="min-h-screen bg-[#f4f7fb] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <PortalLogo className="h-12 w-auto mx-auto" />
        <h1 className="mt-5 text-lg font-semibold text-[#15181e]">
          Portal not found
        </h1>
        <p className="mt-1.5 text-sm text-[#5b6370]">
          This portal link is invalid or has been turned off. Please check the
          link, or contact BrokerStaffer for an updated one.
        </p>
      </div>
    </div>
  );
}
