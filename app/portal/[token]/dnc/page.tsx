import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadDncEntries } from "@/lib/portals/portal-data";
import { DncList } from "@/components/portals/dnc-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Do Not Contact` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function DncPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();
  const entries = await loadDncEntries(client.id);
  return <DncList token={token} entries={entries} />;
}
