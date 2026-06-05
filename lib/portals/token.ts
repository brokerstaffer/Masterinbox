import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";

// Resolves a /portal/<token> token to a client. The token IS the
// credential — every public portal page and edit API uses this to gate
// access. Returns null when the feature is flagged off, the token
// doesn't match, the matching client is the "unknown" fallback, or the
// portal is disabled (portal_enabled=false).

export interface PortalClient {
  id: string;
  name: string;
  slug: string;
  // Raw jsonb map of per-stage label overrides. Use
  // resolveStageLabels() from lib/portals/portal-data.ts to merge
  // these with the defaults before rendering.
  stage_label_overrides: Record<string, unknown>;
}

export const resolvePortalClient = cache(
  async function resolvePortalClient(
    token: string,
  ): Promise<PortalClient | null> {
    if (!CLIENT_PORTALS_ENABLED) return null;
    if (!token || token.length < 4) return null;

    const admin = createAdminSupabase();
    const { data } = await admin
      .from("clients")
      .select(
        "id, name, slug, portal_enabled, stage_label_overrides",
      )
      .eq("portal_token", token)
      .maybeSingle();

    if (!data) return null;
    if (data.slug === "unknown") return null;
    if (data.portal_enabled === false) return null;

    const rawOverrides = data.stage_label_overrides;
    return {
      id: data.id as string,
      name: data.name as string,
      slug: data.slug as string,
      stage_label_overrides:
        rawOverrides && typeof rawOverrides === "object"
          ? (rawOverrides as Record<string, unknown>)
          : {},
    };
  },
);
