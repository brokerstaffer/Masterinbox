import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { NotAuthorized } from "@/app/onboarding/not-authorized";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { syncEmailBisonWorkspaces } from "@/lib/sync/workspaces";

// The onboarding page used to host a "Create workspace" form. Workspaces are
// now mirrored 1:1 from EmailBison teams via the super admin's API key, so
// there's nothing for a regular user to do here. Behaviour:
//   - Super admin lands -> we run sync (idempotent) and redirect to /inbox.
//   - Allowed-but-not-super-admin lands -> "ask an admin to invite you".
//   - Not-on-allowlist -> "not authorized".

export default async function OnboardingPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already a member of at least one workspace? Send them to the inbox.
  const { data: existing } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);
  if (existing && existing.length > 0) redirect("/inbox");

  // Super admin lands here on their very first sign-in. Run the sync to mirror
  // EmailBison teams and self-assign as a member of every workspace.
  if (isSuperAdmin(user.email)) {
    await syncEmailBisonWorkspaces();
    redirect("/inbox");
  }

  // Otherwise: this user signed in but isn't a super admin and hasn't been
  // invited to any workspace yet. Show the "wait for an admin" card.
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md">
        <NotAuthorized email={user.email} />
      </div>
    </div>
  );
}
