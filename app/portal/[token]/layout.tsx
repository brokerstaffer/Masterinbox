import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadPortalCounts } from "@/lib/portals/portal-data";
import { clientHasFeature } from "@/lib/portals/feature-flags";
import { PortalShell } from "@/components/portals/portal-shell";

// Wraps every page under /portal/[token]/ with the shared sidebar nav.
// The token resolves once here; each child page calls
// resolvePortalClient() again — React.cache makes the second call free.

// Portal-scoped social / SEO metadata. Each child page still
// supplies its own title via generateMetadata; Next.js shallow-merges
// fields so the title wins per-page while description, openGraph,
// and twitter card all flow through from here.
//
// The OG image lives next to this file as opengraph-image.png and
// is auto-served by Next's file convention — no explicit
// openGraph.images entry needed.
//
// IMPORTANT: This deliberately doesn't change the global
// app/layout.tsx description ("Unified sales inbox for cold
// outreach email replies."), which is still correct copy for the
// staff MasterInbox app at /. The override below only fires
// underneath /portal/[token]/.
export const metadata: Metadata = {
  description: "Your BrokerStaffer Client Portal",
  openGraph: {
    description: "Your BrokerStaffer Client Portal",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    description: "Your BrokerStaffer Client Portal",
  },
  robots: { index: false, follow: false },
};

export default async function PortalTokenLayout(props: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    // /portal/[token]/page.tsx renders its own "Portal not found" screen
    // for the root URL. For sub-routes (pipeline/agents/dnc/team) a
    // missing token is a hard 404 — there's no content to render.
    notFound();
  }
  const counts = await loadPortalCounts(client.id);

  return (
    <PortalShell
      token={token}
      clientName={client.name}
      counts={counts}
      integrationsLabelEnabled={clientHasFeature(client, "nav_integrations_label")}
    >
      {props.children}
    </PortalShell>
  );
}
