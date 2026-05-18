import { notFound } from "next/navigation";
import { TopBar } from "@/components/inbox/top-bar";
import { TabBar } from "@/components/inbox/tab-bar";
import { FilterBar } from "@/components/inbox/filter-bar";
import { ThreadList } from "@/components/inbox/thread-list";
import { ThreadView } from "@/components/inbox/thread-view";
import { ProspectPanel } from "@/components/inbox/prospect-panel";
import { RealtimeRefresher } from "@/components/inbox/realtime-refresher";
import { requireSession } from "@/lib/auth/workspace";
import { loadThreads } from "@/lib/inbox/threads";
import { loadThreadDetail } from "@/lib/inbox/thread-detail";
import { loadViews, loadViewBySlug } from "@/lib/inbox/views";
import { loadLabels } from "@/lib/inbox/labels";
import { loadChannels } from "@/lib/inbox/channels";
import { loadCampaigns } from "@/lib/inbox/campaigns";
import { loadLists } from "@/lib/inbox/lists";
import { decodeFilter, type FilterState } from "@/lib/inbox/filters";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ThreadDetailPage(props: {
  params: Promise<{ view: string; threadId: string }>;
  searchParams: Promise<{ f?: string; list?: string; page?: string }>;
}) {
  const { view, threadId } = await props.params;
  const { f, list, page } = await props.searchParams;
  const session = await requireSession();
  const filterFromUrl: FilterState | null = f ? decodeFilter(f) : null;
  const pageNum = Math.max(1, Number(page ?? "1") || 1);

  // Mark the thread as seen alongside the page-load queries instead of
  // blocking on it before them. The thread list already optimistically
  // hides the unseen dot on click; realtime broadcasts catch up other tabs.
  // Including it in Promise.all means it runs in parallel with the reads.
  const [threadPage, detail, views, labels, channels, campaigns, lists, currentView] = await Promise.all([
    loadThreads(session.activeWorkspace.id, view, filterFromUrl, list ?? null, pageNum),
    loadThreadDetail(session.activeWorkspace.id, threadId),
    loadViews(session.activeWorkspace.id),
    loadLabels(session.activeWorkspace.id),
    loadChannels(session.activeWorkspace.id),
    loadCampaigns(session.activeWorkspace.id),
    loadLists(session.activeWorkspace.id),
    loadViewBySlug(session.activeWorkspace.id, view),
    // Fire-and-forget seen=true; runs concurrently with the reads.
    // Errors are swallowed (logged in the admin client) since the user
    // experience doesn't depend on the write completing before render.
    createAdminSupabase()
      .from("threads")
      .update({ seen: true })
      .eq("id", threadId)
      .eq("workspace_id", session.activeWorkspace.id),
  ]);
  if (!detail) notFound();

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
        currentViewId={currentView?.id ?? null}
        currentViewName={currentView?.name ?? null}
      />
      <div className="flex-1 min-h-0 flex">
        <aside className="w-[300px] shrink-0 border-r flex flex-col overflow-hidden">
          <div className="px-4 h-10 flex items-center text-sm font-medium border-b">
            All messages
          </div>
          <ThreadList
            threads={threadPage.rows}
            basePath={`/inbox/${view}`}
            activeId={threadId}
            compact
            labels={labels}
            lists={lists}
            total={threadPage.total}
            page={threadPage.page}
            pageSize={threadPage.pageSize}
          />
        </aside>
        <ThreadView
          detail={detail}
          availableLabels={labels}
          backHref={`/inbox/${view}`}
          prevThreadHref={(() => {
            const idx = threadPage.rows.findIndex((t) => t.id === threadId);
            const prev = idx > 0 ? threadPage.rows[idx - 1] : null;
            return prev ? `/inbox/${view}/${prev.id}` : null;
          })()}
          nextThreadHref={(() => {
            const idx = threadPage.rows.findIndex((t) => t.id === threadId);
            const next = idx >= 0 && idx < threadPage.rows.length - 1 ? threadPage.rows[idx + 1] : null;
            return next ? `/inbox/${view}/${next.id}` : null;
          })()}
        />
        <ProspectPanel detail={detail} />
      </div>
      <RealtimeRefresher workspaceId={session.activeWorkspace.id} />
    </>
  );
}
