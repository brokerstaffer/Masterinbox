import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { clientHasFeature } from "@/lib/portals/feature-flags";
import { IdealAgentProfileForm } from "@/components/portals/ideal-agent-profile-form";

// /portal/[token]/ideal-agent-profile — the "Define Your Ideal
// Agent Profile" page. Gated behind clients.feature_flags.ideal_agent_profile
// so a real client typing the URL gets a 404 instead of an exposed
// in-progress feature.

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Ideal Agent Profile` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function IdealAgentProfilePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();
  if (!clientHasFeature(client, "ideal_agent_profile")) notFound();
  return (
    <IdealAgentProfileForm
      token={token}
      initial={
        client.ideal_agent_profile as Parameters<
          typeof IdealAgentProfileForm
        >[0]["initial"]
      }
    />
  );
}
