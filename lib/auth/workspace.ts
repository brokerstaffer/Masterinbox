import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { demoSession, isDemoMode } from "@/lib/demo";

// Single-tenant: Corofy runs exactly one workspace. The 0010 migration
// installs an auth.users trigger that creates the singleton "Corofy"
// workspace on the first sign-up and adds every subsequent user as an
// 'owner' member. The SessionContext shape is kept identical to the old
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

export async function requireSession(): Promise<SessionContext> {
  if (isDemoMode()) {
    return demoSession;
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve the singleton workspace (the oldest row — always exactly one).
  // The auth.users trigger should have created it on sign-up, but we
  // defensively bootstrap here too in case the trigger was skipped (dev
  // mode, manual sign-up before migration, etc).
  let ws = await loadSingletonWorkspace();
  if (!ws) {
    ws = await bootstrapSingletonWorkspace(user.id);
  }

  // Make sure this user is a member. The trigger handles this on sign-up;
  // this branch covers users that existed before the trigger was installed.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", ws.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  let role: WorkspaceSummary["role"] =
    (membership?.role as WorkspaceSummary["role"] | undefined) ?? "owner";
  if (!membership) {
    const admin = createAdminSupabase();
    await admin
      .from("workspace_members")
      .insert({
        workspace_id: ws.id,
        user_id: user.id,
        role: "owner",
        status: "active",
      });
    role = "owner";
  }

  const summary: WorkspaceSummary = {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    role,
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

async function loadSingletonWorkspace(): Promise<{
  id: string;
  name: string;
  slug: string;
} | null> {
  // Use the service-role client so we always see the row even when the
  // current user hasn't been added as a member yet (the chicken-and-egg
  // case during very-first sign-up that races the auth.users trigger).
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("workspaces")
    .select("id, name, slug")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function bootstrapSingletonWorkspace(ownerUserId: string): Promise<{
  id: string;
  name: string;
  slug: string;
}> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("workspaces")
    .insert({ name: "Corofy", slug: "corofy", owner_user_id: ownerUserId })
    .select("id, name, slug")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to bootstrap Corofy workspace: ${error?.message ?? "unknown error"}`,
    );
  }
  return data;
}

// Retained as an export so legacy call sites that import WORKSPACE_COOKIE
// keep compiling. No longer set or read — kept only to avoid touching every
// file that imported it. Safe to remove once those imports are gone.
export const WORKSPACE_COOKIE = "corofy_active_workspace";
