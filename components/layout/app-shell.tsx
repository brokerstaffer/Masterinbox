import { IconRail } from "@/components/layout/icon-rail";
import { Sidebar } from "@/components/layout/sidebar";
import { requireSession } from "@/lib/auth/workspace";
import { loadLists, loadListUnseenCounts } from "@/lib/inbox/lists";

// Renders the persistent inbox chrome: icon rail + workspace sidebar. Used by
// every page under (app)/. Onboarding lives outside this group.
export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [lists, listCounts] = await Promise.all([
    loadLists(session.activeWorkspace.id),
    loadListUnseenCounts(session.activeWorkspace.id),
  ]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <IconRail />
      <Sidebar session={session} lists={lists} listCounts={listCounts} />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
