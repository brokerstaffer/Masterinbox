import { SettingsPageShell } from "@/components/settings/page-shell";
import { LabelsManager } from "@/components/settings/labels-manager";
import { requireSession } from "@/lib/auth/workspace";
import { loadLabels } from "@/lib/inbox/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireSession();
  const labels = await loadLabels(session.activeWorkspace.id);

  return (
    <SettingsPageShell
      title="Label Management"
      description="Curate the labels applied to inbound replies. System labels seed every workspace; custom labels are yours to define."
    >
      <LabelsManager labels={labels} />
    </SettingsPageShell>
  );
}
