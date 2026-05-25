import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadAgentEntries } from "@/lib/portals/portal-data";
import { AgentsList } from "@/components/portals/agents-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Your Agents` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function AgentsPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();
  const entries = await loadAgentEntries(client.id);
  return <AgentsList token={token} entries={entries} />;
}
