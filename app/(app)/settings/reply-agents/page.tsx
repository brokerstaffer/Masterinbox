import { SettingsPageShell } from "@/components/settings/page-shell";
import { ReplyAgentsManager } from "@/components/settings/reply-agents-manager";
import { requireSession } from "@/lib/auth/workspace";
import { loadAgents } from "@/lib/ai/agent";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireSession();
  const agents = await loadAgents(session.activeWorkspace.id);

  return (
    <SettingsPageShell
      title="Reply Agents"
      description="Configure AI agents that draft replies for you. Human-in-the-loop drafts surface in the composer; auto-respond agents send directly."
    >
      <ReplyAgentsManager agents={agents} />
    </SettingsPageShell>
  );
}
