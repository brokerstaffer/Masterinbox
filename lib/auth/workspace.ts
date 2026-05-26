import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { demoSession, isDemoMode } from "@/lib/demo";
import { env } from "@/lib/env";

// Single-tenant: BrokerStaffer runs exactly one workspace. The 0010
// migration installs an auth.users trigger that creates the singleton
// workspace on the first sign-up and adds every subsequent user as an
// 'owner' member. The SessionContext shape stays identical to the old
// multi-workspace API (workspaces: WorkspaceSummary[], activeWorkspace:
// WorkspaceSummary) so existing pages that destructure
// `session.activeWorkspace.id` keep working unchanged.

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

export interface SessionContext {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
  };
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary;
}

// Wrapped in React.cache so multiple call sites within a single render
// (page server component, child components, etc.) share the same query.
// Without cache(), every component calling requireSession() would fire
// another full RTT to Supabase.
export const requireSession = cache(async function requireSession(): Promise<SessionContext> {
  if (isDemoMode()) {
    return demoSession;
  }

  const supabase = await createServerSupabase();
  // getUser() actually verifies the JWT against Supabase's auth server
  // — costs one ~280ms round-trip but is the only way to be sure the
  // cookie wasn't tampered with. getSession() reads cookie content
  // without verifying and Supabase JS logs a security warning every
  // time we use its `user` field; using getUser() silences that warning
  // and matches what the proxy.ts middleware already does. React.cache
  // around this function ensures we only make one call per page render
  // regardless of how many components ask.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Hot path: when WORKSPACE_ID is set, skip the workspace lookup query
  // entirely — BrokerStaffer is single-tenant so the workspace is known
  // ahead of time. This saves ~280ms (one Supabase round-trip) on EVERY
  // page render. Everything we need (id, name, slug) is static metadata
  // we can hardcode in env. Role is always 'owner' in single-tenant.
  if (env.WORKSPACE_ID) {
    const summary: WorkspaceSummary = {
      id: env.WORKSPACE_ID,
      name: "BrokerStaffer",
      slug: "brokerstaffer",
      role: "owner",
    };
    return {
      user: {
        id: user.id,
        email: user.email ?? null,
        name: (user.user_metadata?.full_name as string | undefined) ?? null,
        avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      },
      workspaces: [summary],
      activeWorkspace: summary,
    };
  }

  // Fallback path — only fires in dev or before WORKSPACE_ID is
  // configured. One round-trip: pull membership + joined workspace.
  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);
  if (error) {
    throw new Error(`Failed to load workspace: ${error.message}`);
  }

  type Row = {
    role: WorkspaceSummary["role"];
    workspaces:
      | { id: string; name: string; slug: string }
      | { id: string; name: string; slug: string }[]
      | null;
  };
  const row = (memberships?.[0] as Row | undefined) ?? null;
  const ws = row?.workspaces
    ? Array.isArray(row.workspaces)
      ? row.workspaces[0]
      : row.workspaces
    : null;

  let summary: WorkspaceSummary | null = ws
    ? { id: ws.id, name: ws.name, slug: ws.slug, role: row!.role }
    : null;

  if (!summary) {
    summary = await bootstrapMembership(user.id);
  }

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      name: (user.user_metadata?.full_name as string | undefined) ?? null,
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
    workspaces: [summary],
    activeWorkspace: summary,
  };
});

// Defensive path: look up the singleton workspace; create it if it
// doesn't exist; insert a membership row for this user. Uses the admin
// client to bypass RLS during bootstrap. Runs at most once per user.
async function bootstrapMembership(userId: string): Promise<WorkspaceSummary> {
  const admin = createAdminSupabase();
  const { data: existingWs } = await admin
    .from("workspaces")
    .select("id, name, slug")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let ws = existingWs;
  if (!ws) {
    const { data: created, error } = await admin
      .from("workspaces")
      .insert({
        name: "BrokerStaffer",
        slug: "brokerstaffer",
        owner_user_id: userId,
      })
      .select("id, name, slug")
      .single();
    if (error || !created) {
      throw new Error(
        `Failed to bootstrap BrokerStaffer workspace: ${error?.message ?? "unknown error"}`,
      );
    }
    ws = created;
  }

  await admin
    .from("workspace_members")
    .insert({
      workspace_id: ws.id,
      user_id: userId,
      role: "owner",
      status: "active",
    })
    .select("id")
    .maybeSingle();

  return { id: ws.id, name: ws.name, slug: ws.slug, role: "owner" };
}

// Retained for back-compat with any caller still importing this constant.
// No longer set or read in the codebase — single-tenant has no concept
// of an "active" workspace to remember.
export const WORKSPACE_COOKIE = "active_workspace";
