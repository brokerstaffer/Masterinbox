import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadTeamMembers } from "@/lib/portals/portal-data";
import { TeamList } from "@/components/portals/team-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Team` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function TeamPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();
  const members = await loadTeamMembers(client.id);
  return <TeamList token={token} members={members} />;
}
