// /inbox/[view] (no thread selected). The persistent shell (TopBar +
// TabBar + FilterBar + ThreadList sidebar) lives in [view]/layout.tsx
// so it stays mounted across thread navigations. This page only
// renders what goes to the RIGHT of the thread list when nothing is
// selected.

export const dynamic = "force-dynamic";

export default function InboxViewIndex() {
  return (
    <section className="flex-1 min-w-0 flex items-center justify-center bg-background text-sm text-muted-foreground">
      Select a conversation on the left.
    </section>
  );
}
