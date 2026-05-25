import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadPipelineEntries } from "@/lib/portals/portal-data";
import { PipelineBoard } from "@/components/portals/pipeline-board";
import { PortalRefresher } from "@/components/portals/portal-refresher";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Recruiting Pipeline` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function PipelinePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();
  const entries = await loadPipelineEntries(client.id);

  return (
    <>
      <PortalRefresher />
      <PipelineBoard token={token} entries={entries} />
    </>
  );
}
