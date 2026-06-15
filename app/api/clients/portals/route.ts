import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadPortalCounts } from "@/lib/portals/portal-data";
import { publicPortalUrl } from "@/lib/portals/public-url";
import { env } from "@/lib/env";

// GET /api/clients/portals
//
// Returns every client that has been added to MasterInbox AND has an
// active portal — `portal_enabled = true`, a non-empty portal_token,
// and the row is NOT the "unknown" fallback bucket. Each entry
// carries the metadata + per-portal counts you'd otherwise have to
// reassemble from /api/clients/intros + the admin /portals page.
//
// Auth: same model as /api/clients/intros — a normal user session OR
// `?token=<SUPABASE_SERVICE_ROLE_KEY>` / `x-admin-token: ...` for
// scripted callers. The service-role path also accepts an explicit
// `?workspace=<uuid>` (defaults to env.WORKSPACE_ID — the pinned
// singleton on production).
//
// The response intentionally NEVER ships raw secrets — `fub_api_key`
// is exposed as a boolean `fub_connected` plus the connect timestamp.
// Stage-label overrides + feature flags ride through verbatim so
// admin tooling can tell at a glance which clients have customised
// what.

export const dynamic = "force-dynamic";

interface PortalClientRow {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  portal_token: string;
  portal_url: string | null;
  portal_enabled: boolean;
  fub_connected: boolean;
  fub_connected_at: string | null;
  feature_flags: Record<string, unknown>;
  stage_label_overrides: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  counts: { pipeline: number; agents: number; dnc: number; team: number };
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const suppliedToken =
    url.searchParams.get("token") ?? request.headers.get("x-admin-token");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  let workspaceId: string;
  if (suppliedToken && serviceKey && suppliedToken === serviceKey) {
    workspaceId =
      url.searchParams.get("workspace") ?? env.WORKSPACE_ID ?? "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspace param required when using service-role token" },
        { status: 400 },
      );
    }
  } else {
    const userClient = await createServerSupabase();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = await requireSession();
    workspaceId = session.activeWorkspace.id;
  }

  const admin = createAdminSupabase();

  // Defensive SELECT: try the column list that includes the newer
  // optional columns (feature_flags, fub_*). If a migration is
  // lagging in some environment, fall back to the base column set
  // and synthesise empty values for the missing ones. Same pattern
  // resolvePortalClient uses — keeps the endpoint useful even
  // during a half-applied schema state.
  const SELECT_WITH_ALL =
    "id, name, slug, aliases, portal_token, portal_enabled, fub_api_key, fub_connected_at, feature_flags, stage_label_overrides, created_at, updated_at";
  const SELECT_BASE =
    "id, name, slug, aliases, portal_token, portal_enabled, created_at, updated_at";

  type FullRow = {
    id: string;
    name: string;
    slug: string;
    aliases: string[] | null;
    portal_token: string | null;
    portal_enabled: boolean | null;
    fub_api_key?: string | null;
    fub_connected_at?: string | null;
    feature_flags?: Record<string, unknown> | null;
    stage_label_overrides?: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  };

  let rows: FullRow[] | null = null;
  const first = await admin
    .from("clients")
    .select(SELECT_WITH_ALL)
    .neq("slug", "unknown")
    .eq("portal_enabled", true)
    .not("portal_token", "is", null)
    .order("name", { ascending: true });
  if (first.error) {
    const msg = (first.error.message ?? "").toLowerCase();
    const missingColumn =
      first.error.code === "42703" ||
      msg.includes("does not exist");
    if (!missingColumn) {
      return NextResponse.json({ error: first.error.message }, { status: 500 });
    }
    const retry = await admin
      .from("clients")
      .select(SELECT_BASE)
      .neq("slug", "unknown")
      .eq("portal_enabled", true)
      .not("portal_token", "is", null)
      .order("name", { ascending: true });
    if (retry.error) {
      return NextResponse.json({ error: retry.error.message }, { status: 500 });
    }
    rows = (retry.data ?? []) as FullRow[];
  } else {
    rows = (first.data ?? []) as FullRow[];
  }
  // `workspaceId` is part of the auth contract for parity with
  // /api/clients/intros — clients themselves are workspace-agnostic
  // in this single-tenant deployment, but we still surface the
  // resolved id in the response for caller-side observability.

  // Fetch every client's counts in parallel. ~30 clients per
  // workspace today; loadPortalCounts is a single RPC per client.
  const enriched = await Promise.all(
    rows.map(async (row): Promise<PortalClientRow> => {
      let counts = { pipeline: 0, agents: 0, dnc: 0, team: 0 };
      try {
        counts = await loadPortalCounts(row.id);
      } catch (err) {
        console.error("[clients/portals] counts failed for", row.id, err);
      }
      const rawOverrides = row.stage_label_overrides;
      const rawFlags = row.feature_flags;
      const fubKey = row.fub_api_key;
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        aliases: row.aliases ?? [],
        portal_token: row.portal_token ?? "",
        portal_url: publicPortalUrl(row.portal_token),
        portal_enabled: row.portal_enabled !== false,
        fub_connected:
          typeof fubKey === "string" && fubKey.trim().length > 0,
        fub_connected_at: row.fub_connected_at ?? null,
        feature_flags:
          rawFlags && typeof rawFlags === "object" && !Array.isArray(rawFlags)
            ? (rawFlags as Record<string, unknown>)
            : {},
        stage_label_overrides:
          rawOverrides &&
          typeof rawOverrides === "object" &&
          !Array.isArray(rawOverrides)
            ? (rawOverrides as Record<string, unknown>)
            : {},
        created_at: row.created_at,
        updated_at: row.updated_at,
        counts,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    workspace_id: workspaceId,
    count: enriched.length,
    clients: enriched,
  });
}
