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

// Preserve the active list / filter / page / search across the
// thread-detail Back, Prev, and Next links. Without this the next
// thread's URL would drop the ?list=… (and ?f=…) params and dump
// the user back to the unfiltered view — the exact behaviour
// flagged in the SERHANT. list bug report.
function buildSuffix(
  f: string | undefined,
  list: string | undefined,
  page: string | undefined,
  q: string | undefined,
): string {
  const params = new URLSearchParams();
  if (f) params.set("f", f);
  if (list) params.set("list", list);
  if (page) params.set("page", page);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default async function ThreadDetailPage(props: {
  params: Promise<{ view: string; threadId: string }>;
  searchParams: Promise<{ f?: string; list?: string; page?: string; q?: string }>;
}) {
  const { view, threadId } = await props.params;
  const { f, list, page, q } = await props.searchParams;

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
  const searchQuery = q?.trim() || null;

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
    timed("loadThreads", loadThreads(session.activeWorkspace.id, view, filterFromUrl, list ?? null, pageNum, searchQuery)),
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

  // EmailBison channels only store a friendly display_name like
  // "Nicole Collins" — the actual sending address isn't on the row.
  // Derive it from the most recent outbound message on each channel
  // so the SenderPicker can disambiguate when several rows share a
  // display_name. Instantly channels already carry the address on
  // instantly_account_id, so they don't need this lookup.
  const ebChannelIds = channels
    .filter((c) => c.provider === "emailbison" && c.id)
    .map((c) => c.id);
  const emailByChannelId = new Map<string, string>();
  if (ebChannelIds.length > 0) {
    const { data: outboundRows } = await createAdminSupabase()
      .from("messages")
      .select("channel_id, sender")
      .eq("workspace_id", session.activeWorkspace.id)
      .eq("direction", "outbound")
      .in("channel_id", ebChannelIds)
      .not("sender", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1000);
    for (const m of (outboundRows ?? []) as Array<{
      channel_id: string;
      sender: string | null;
    }>) {
      if (!m.sender || !m.channel_id) continue;
      if (!emailByChannelId.has(m.channel_id)) {
        emailByChannelId.set(m.channel_id, m.sender);
      }
    }
  }

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
          channels={channels
            .filter(
              (c): c is typeof c & {
                provider: "instantly" | "emailbison" | "unipile";
                display_name: string;
              } => Boolean(c.provider) && Boolean(c.display_name),
            )
            .map((c) => ({
              id: c.id,
              provider: c.provider,
              display_name: c.display_name,
              instantly_account_id: c.instantly_account_id ?? null,
              email:
                c.instantly_account_id ??
                c.external_account_id ??
                emailByChannelId.get(c.id) ??
                null,
            }))}
          backHref={`/inbox/${view}${buildSuffix(f, list, page, q)}`}
          prevThreadHref={(() => {
            const idx = threadPage.rows.findIndex((t) => t.id === threadId);
            const prev = idx > 0 ? threadPage.rows[idx - 1] : null;
            return prev ? `/inbox/${view}/${prev.id}${buildSuffix(f, list, page, q)}` : null;
          })()}
          nextThreadHref={(() => {
            const idx = threadPage.rows.findIndex((t) => t.id === threadId);
            const next = idx >= 0 && idx < threadPage.rows.length - 1 ? threadPage.rows[idx + 1] : null;
            return next ? `/inbox/${view}/${next.id}${buildSuffix(f, list, page, q)}` : null;
          })()}
        />
        <ProspectPanel detail={detail} />
      </div>
      <RealtimeRefresher workspaceId={session.activeWorkspace.id} />
      <ClickRenderTiming threadId={threadId} />
    </>
  );
}
