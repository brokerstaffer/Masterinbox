import { TopBar } from "@/components/inbox/top-bar";
import { TabBar } from "@/components/inbox/tab-bar";
import { FilterBar } from "@/components/inbox/filter-bar";
import { ThreadList } from "@/components/inbox/thread-list";
import { RealtimeRefresher } from "@/components/inbox/realtime-refresher";
import { InboxProvider } from "@/components/inbox/inbox-context";
import { requireSession } from "@/lib/auth/workspace";
import { loadThreads } from "@/lib/inbox/threads";
import { loadViews, loadViewBySlug } from "@/lib/inbox/views";
import { loadLabels } from "@/lib/inbox/labels";
import { loadChannels } from "@/lib/inbox/channels";
import { loadCampaigns } from "@/lib/inbox/campaigns";
import { loadLists } from "@/lib/inbox/lists";
import { decodeFilter, type FilterState, type FilterRow } from "@/lib/inbox/filters";

// Persistent shell for everything under /inbox/[view]. Mounting the
// TopBar, TabBar, FilterBar, and ThreadList here means Next.js DOES NOT
// re-execute their data fetches when the user navigates between
// [threadId] pages within the same view. The shell HTML stays mounted;
// only the right-pane child page re-renders on click.
//
// Before this hoist, every thread click re-ran 7 loaders (~540ms total
// server time bounded by loadThreads) AND re-rendered 79+ thread rows
// on the client. After this hoist, a thread click only fetches
// loadThreadDetail (~330ms) and only re-renders the right pane.
export default async function InboxViewLayout({
  children,
  params,
  searchParams,
}: {
  children: React.ReactNode;
  params: Promise<{ view: string }>;
  searchParams?: Promise<{ f?: string; list?: string; page?: string }>;
}) {
  const { view } = await params;
  const sp = (await searchParams) ?? {};
  const filterFromUrl: FilterState | null = sp.f ? decodeFilter(sp.f) : null;
  const pageNum = Math.max(1, Number(sp.page ?? "1") || 1);

  const session = await requireSession();
  const [threadPage, views, labels, channels, campaigns, lists, currentView] = await Promise.all([
    loadThreads(session.activeWorkspace.id, view, filterFromUrl, sp.list ?? null, pageNum),
    loadViews(session.activeWorkspace.id),
    loadLabels(session.activeWorkspace.id),
    loadChannels(session.activeWorkspace.id),
    loadCampaigns(session.activeWorkspace.id),
    loadLists(session.activeWorkspace.id),
    loadViewBySlug(session.activeWorkspace.id, view),
  ]);

  const initialFilter: FilterState =
    filterFromUrl ?? {
      rows: (currentView?.filter_json as { rows?: FilterRow[] } | undefined)?.rows ?? [],
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
        currentViewId={currentView?.id ?? null}
        currentViewName={currentView?.name ?? null}
      />
      <InboxProvider
        value={{
          workspaceId: session.activeWorkspace.id,
          basePath: `/inbox/${view}`,
          threads: threadPage.rows,
          labels,
        }}
      >
        <div className="flex-1 min-h-0 flex">
          <aside className="w-[300px] shrink-0 border-r flex flex-col overflow-hidden">
            <div className="px-4 h-10 flex items-center text-sm font-medium border-b">
              All messages
            </div>
            <ThreadList
              threads={threadPage.rows}
              basePath={`/inbox/${view}`}
              compact
              labels={labels}
              lists={lists}
              total={threadPage.total}
              page={threadPage.page}
              pageSize={threadPage.pageSize}
            />
          </aside>
          {children}
        </div>
      </InboxProvider>
      <RealtimeRefresher workspaceId={session.activeWorkspace.id} />
    </>
  );
}
