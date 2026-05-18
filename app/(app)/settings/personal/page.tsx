import { SettingsPageShell } from "@/components/settings/page-shell";
import { requireSession } from "@/lib/auth/workspace";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

export default async function PersonalDetailsPage() {
  const session = await requireSession();
  return (
    <SettingsPageShell title="Personal details" description="Your account information.">
      <div className="rounded-lg border bg-card divide-y">
        <div className="p-6 space-y-4 max-w-lg">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" defaultValue={session.user.email ?? ""} readOnly disabled />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card divide-y mt-6">
        <div className="px-6 py-4">
          <h2 className="text-sm font-semibold">Change password</h2>
        </div>
        <ChangePasswordForm />
      </div>
    </SettingsPageShell>
  );
}
