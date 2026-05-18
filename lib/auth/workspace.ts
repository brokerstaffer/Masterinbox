import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { demoSession, isDemoMode } from "@/lib/demo";

// Single-tenant: Corofy runs exactly one workspace. The 0010 migration
// installs an auth.users trigger that creates the singleton "Corofy"
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

// Fast path: ONE cookie read (getSession) + ONE joined Supabase query.
// Wrapped in React.cache so multiple call sites within a single render
// (page server component, child components, etc.) share the same query.
// Without cache(), every component calling requireSession() would fire
// another full RTT to Supabase.
export const requireSession = cache(async function requireSession(): Promise<SessionContext> {
  if (isDemoMode()) {
    return demoSession;
  }

  const supabase = await createServerSupabase();
  // Use getSession() — reads from the signed Supabase cookie, no network
  // round-trip. getUser() phones home to /auth/v1/user to re-verify the
  // JWT and was costing ~280ms per page render. The cookie is HttpOnly +
  // signed; if it's present and parseable we trust it. The proxy
  // middleware already refreshes/invalidates the cookie when needed.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  // One round-trip: pull the user's membership + the joined workspace
  // row. For Corofy this always returns 0 or 1 row.
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

  // Slow defensive path — only hits when the auth.users trigger hasn't
  // fired yet OR the user signed up before the trigger was installed.
  // Should be a one-time per-user cost; subsequent requests use the
  // fast path above.
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
      .insert({ name: "Corofy", slug: "corofy", owner_user_id: userId })
      .select("id, name, slug")
      .single();
    if (error || !created) {
      throw new Error(
        `Failed to bootstrap Corofy workspace: ${error?.message ?? "unknown error"}`,
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
export const WORKSPACE_COOKIE = "corofy_active_workspace";
