import { SettingsPageShell } from "@/components/settings/page-shell";
import { ClientsManager } from "@/components/settings/clients-manager";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireSession();

  // Server-side load. Mirrors GET /api/clients shape so the manager
  // gets a fully-populated initial render (no first-paint flash).
  const admin = createAdminSupabase();
  const [{ data: clients }, { data: counts }] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, slug, aliases")
      .order("name", { ascending: true }),
    admin
      .from("threads")
      .select("client_id")
      .not("client_id", "is", null),
  ]);

  const byId = new Map<string, number>();
  for (const r of counts ?? []) {
    const k = r.client_id as string;
    byId.set(k, (byId.get(k) ?? 0) + 1);
  }
  const initial = (clients ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    slug: c.slug as string,
    aliases: (c.aliases as string[] | null) ?? [],
    thread_count: byId.get(c.id as string) ?? 0,
    is_system: (c.slug as string) === "unknown",
  }));

  return (
    <SettingsPageShell
      title="Clients"
      description="BrokerStaffer's active clients. Each inbound reply gets auto-tagged against one of these by matching the campaign name against the client's name or aliases. Replies that don't match any client land on the 'Unknown' fallback."
    >
      <ClientsManager initial={initial} />
    </SettingsPageShell>
  );
}
