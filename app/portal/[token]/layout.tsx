import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadPortalCounts } from "@/lib/portals/portal-data";
import { PortalShell } from "@/components/portals/portal-shell";

// Wraps every page under /portal/[token]/ with the shared sidebar nav.
// The token resolves once here; each child page calls
// resolvePortalClient() again — React.cache makes the second call free.

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
    <PortalShell token={token} clientName={client.name} counts={counts}>
      {props.children}
    </PortalShell>
  );
}
