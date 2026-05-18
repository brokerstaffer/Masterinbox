import { SettingsPageShell } from "@/components/settings/page-shell";
import { AiLabelingForm } from "@/components/settings/ai-labeling-form";
import { requireSession } from "@/lib/auth/workspace";
import { loadAiConfig } from "@/lib/ai/config";
import { loadLabels } from "@/lib/inbox/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireSession();
  const [config, labels] = await Promise.all([
    loadAiConfig(session.activeWorkspace.id),
    loadLabels(session.activeWorkspace.id),
  ]);

  return (
    <SettingsPageShell
      title="AI Labeling"
      description="Auto-label inbound replies using an AI provider. Pick a provider, paste an API key, and choose which of your labels the model can apply."
    >
      <AiLabelingForm initial={config} labels={labels} />
    </SettingsPageShell>
  );
}
