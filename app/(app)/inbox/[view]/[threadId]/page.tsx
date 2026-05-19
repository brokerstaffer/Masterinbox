import { notFound } from "next/navigation";
import { ThreadView } from "@/components/inbox/thread-view";
import { ProspectPanel } from "@/components/inbox/prospect-panel";
import { ClickRenderTiming } from "@/components/inbox/perf-timing";
import { requireSession } from "@/lib/auth/workspace";
import { loadThreadDetail } from "@/lib/inbox/thread-detail";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// THE per-thread page. Everything shell-shaped (TopBar/TabBar/FilterBar/
// ThreadList sidebar) lives in [view]/layout.tsx and stays mounted
// across thread navigations. This page only loads the data it uniquely
// needs (the thread detail + a `seen=true` write) and renders the
// right-pane content. labels + adjacent threads are read from
// InboxContext set up by the layout.
//
// Server-side timing instrumentation prints `[thread-detail t=…ms] step`
// in Railway logs so we can verify the architectural fix dropped click
// latency. Safe to remove once the performance is settled.
export default async function ThreadDetailPage(props: {
  params: Promise<{ view: string; threadId: string }>;
}) {
  const { view, threadId } = await props.params;

  const t0 = Date.now();
  const ts = (label: string) =>
    console.log(`[thread-detail t=${Date.now() - t0}ms] ${label}`);

  ts("start");
  const session = await requireSession();
  ts("after requireSession");

  const [detail] = await Promise.all([
    loadThreadDetail(session.activeWorkspace.id, threadId),
    // Fire-and-forget seen=true; concurrent with the detail read.
    Promise.resolve(
      createAdminSupabase()
        .from("threads")
        .update({ seen: true })
        .eq("id", threadId)
        .eq("workspace_id", session.activeWorkspace.id),
    ),
  ]);
  ts("after Promise.all");
  if (!detail) notFound();
  ts("ready to render");

  return (
    <>
      <ThreadView detail={detail} backHref={`/inbox/${view}`} />
      <ProspectPanel detail={detail} />
      <ClickRenderTiming threadId={threadId} />
    </>
  );
}
