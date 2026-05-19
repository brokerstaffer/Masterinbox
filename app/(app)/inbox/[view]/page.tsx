import { TopBar } from "@/components/inbox/top-bar";
import { TabBar } from "@/components/inbox/tab-bar";
import { FilterBar } from "@/components/inbox/filter-bar";
import { EmptyInbox } from "@/components/inbox/empty-state";
import { ThreadList } from "@/components/inbox/thread-list";
import { RealtimeRefresher } from "@/components/inbox/realtime-refresher";
import { requireSession } from "@/lib/auth/workspace";
import { loadThreads } from "@/lib/inbox/threads";
import { loadViews, loadViewBySlug } from "@/lib/inbox/views";
import { loadLabels } from "@/lib/inbox/labels";
import { loadChannels } from "@/lib/inbox/channels";
import { loadCampaigns } from "@/lib/inbox/campaigns";
import { loadClients } from "@/lib/inbox/clients";
import { loadLists } from "@/lib/inbox/lists";
import { decodeFilter, type FilterState } from "@/lib/inbox/filters";

export const dynamic = "force-dynamic";

export default async function InboxView(props: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ f?: string; list?: string; page?: string }>;
}) {
  const { view } = await props.params;
  const { f, list, page } = await props.searchParams;
  const session = await requireSession();
  const filterFromUrl: FilterState | null = f ? decodeFilter(f) : null;
  const pageNum = Math.max(1, Number(page ?? "1") || 1);
  const [threadPage, views, labels, channels, campaigns, clients, lists, currentView] = await Promise.all([
    loadThreads(session.activeWorkspace.id, view, filterFromUrl, list ?? null, pageNum),
    loadViews(session.activeWorkspace.id),
    loadLabels(session.activeWorkspace.id),
    loadChannels(session.activeWorkspace.id),
    loadCampaigns(session.activeWorkspace.id),
    loadClients(session.activeWorkspace.id),
    loadLists(session.activeWorkspace.id),
    loadViewBySlug(session.activeWorkspace.id, view),
  ]);

  const initialFilter: FilterState =
    filterFromUrl ?? {
      rows:
        (currentView?.filter_json as { rows?: import("@/lib/inbox/filters").FilterRow[] } | undefined)
          ?.rows ?? [],
    };

  return (
    <>
      <TopBar />
      <TabBar views={views} activeSlug={view} labels={labels} />
      <FilterBar
        initialFilter={initialFilter}
        labels={labels}
        channels={channels}
        campaigns={campaigns}
        clients={clients}
        currentViewId={currentView?.id ?? null}
        currentViewName={currentView?.name ?? null}
      />
      {threadPage.rows.length === 0 && threadPage.total === 0 ? (
        <EmptyInbox view={view} />
      ) : (
        <ThreadList
          threads={threadPage.rows}
          basePath={`/inbox/${view}`}
          labels={labels}
          lists={lists}
          total={threadPage.total}
          page={threadPage.page}
          pageSize={threadPage.pageSize}
        />
      )}
      <RealtimeRefresher workspaceId={session.activeWorkspace.id} />
    </>
  );
}
