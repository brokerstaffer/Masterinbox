import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadPipelineEntries, loadTeamMembers } from "@/lib/portals/portal-data";
import {
  PipelineHeader,
  PipelineFooterInfo,
} from "@/components/portals/pipeline-header";
import { PipelineBoard } from "@/components/portals/pipeline-board";
import { PortalLogo } from "@/components/portals/portal-logo";

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

  return (
    <>
      <PipelineHeader clientName={client.name} />
      <PipelineBoard token={token} entries={entries} teamMembers={teamMembers} />
      <PipelineFooterInfo />
    </>
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
