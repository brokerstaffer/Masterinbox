import { notFound } from "next/navigation";
import { TopBar } from "@/components/inbox/top-bar";
import { TabBar } from "@/components/inbox/tab-bar";
import { FilterBar } from "@/components/inbox/filter-bar";
import { ThreadList } from "@/components/inbox/thread-list";
import { ThreadView } from "@/components/inbox/thread-view";
import { ProspectPanel } from "@/components/inbox/prospect-panel";
import { RealtimeRefresher } from "@/components/inbox/realtime-refresher";
import { ClickRenderTiming } from "@/components/inbox/perf-timing";
import { requireSession } from "@/lib/auth/workspace";
import { loadThreads } from "@/lib/inbox/threads";
import { loadThreadDetail } from "@/lib/inbox/thread-detail";
import { loadViews, loadViewBySlug, loadViewCounts } from "@/lib/inbox/views";
import { loadLabels } from "@/lib/inbox/labels";
import { loadChannels } from "@/lib/inbox/channels";
import { loadCampaigns } from "@/lib/inbox/campaigns";
import { loadClients } from "@/lib/inbox/clients";
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

  // Server-side timing instrumentation — appears in Railway logs as
  // `[thread-detail t=…ms] step` so we can identify which step actually
  // dominates wall-clock time per click.
  const t0 = Date.now();
  const ts = (label: string) =>
    console.log(`[thread-detail t=${Date.now() - t0}ms] ${label}`);

  ts("start");
  const session = await requireSession();
  ts("after requireSession");
  const filterFromUrl: FilterState | null = f ? decodeFilter(f) : null;
  const pageNum = Math.max(1, Number(page ?? "1") || 1);

  // Per-loader timing. Wrap each promise so we know wall-clock duration
  // of each parallel branch. Reveals which one is the slowest (bounds
  // Promise.all's total time).
  const timed = <T,>(name: string, p: Promise<T>): Promise<T> => {
    const start = Date.now();
    return p.then((v) => {
      console.log(`[thread-detail t=${Date.now() - t0}ms]   loader '${name}' done in ${Date.now() - start}ms`);
      return v;
    });
  };

  const [threadPage, detail, views, viewCounts, labels, channels, campaigns, clients, lists, currentView] = await Promise.all([
    timed("loadThreads", loadThreads(session.activeWorkspace.id, view, filterFromUrl, list ?? null, pageNum)),
    timed("loadThreadDetail", loadThreadDetail(session.activeWorkspace.id, threadId)),
    timed("loadViews", loadViews(session.activeWorkspace.id)),
    timed("loadViewCounts", loadViewCounts(session.activeWorkspace.id, list ?? null)),
    timed("loadLabels", loadLabels(session.activeWorkspace.id)),
    timed("loadChannels", loadChannels(session.activeWorkspace.id)),
    timed("loadCampaigns", loadCampaigns(session.activeWorkspace.id)),
    timed("loadClients", loadClients(session.activeWorkspace.id)),
    timed("loadLists", loadLists(session.activeWorkspace.id)),
    timed("loadViewBySlug", loadViewBySlug(session.activeWorkspace.id, view)),
    timed(
      "seen=true update",
      Promise.resolve(
        createAdminSupabase()
          .from("threads")
          .update({ seen: true })
          .eq("id", threadId)
          .eq("workspace_id", session.activeWorkspace.id),
      ).then(() => undefined),
    ),
  ]);
  ts("after Promise.all (all loaders)");
  if (!detail) notFound();
  ts("ready to render");

  const initialFilter: FilterState =
    filterFromUrl ?? {
      rows:
        (currentView?.filter_json as { rows?: import("@/lib/inbox/filters").FilterRow[] } | undefined)
          ?.rows ?? [],
    };

  return (
    <>
      <TopBar />
      <TabBar views={views} activeSlug={view} labels={labels} viewCounts={viewCounts} />
      <FilterBar
        initialFilter={initialFilter}
        labels={labels}
        channels={channels}
        campaigns={campaigns}
        clients={clients}
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
      <ClickRenderTiming threadId={threadId} />
    </>
  );
}
