import { SettingsPageShell } from "@/components/settings/page-shell";
import { TemplatesManager } from "@/components/settings/templates-manager";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  const session = await requireSession();
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("reply_templates")
    .select("id, name, body, sort_order")
    .eq("workspace_id", session.activeWorkspace.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const initial = (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    body: t.body as string,
  }));

  return (
    <SettingsPageShell
      title="Templates"
      description="Saved reply snippets you can drop into the composer instead of retyping."
    >
      <TemplatesManager initial={initial} />
    </SettingsPageShell>
  );
}
