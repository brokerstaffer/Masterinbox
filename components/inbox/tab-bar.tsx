"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MoreHorizontal, Plus, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomView } from "@/lib/inbox/views-shared";
import type { LabelRow } from "@/lib/inbox/labels-shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NewViewDialog } from "@/components/inbox/new-view-dialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function TabBar({
  views,
  activeSlug,
  labels = [],
  viewCounts = {},
}: {
  views: CustomView[];
  activeSlug: string | null;
  labels?: LabelRow[];
  // Map of view.id → { unseen count, % of open threads }. Computed
  // server-side; rendered as a "N new" pill + a "%" next to each tab.
  viewCounts?: Record<string, { unseen: number; pct: number | null }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Preserve the active sidebar list when switching tabs so opening
  // "Interested" while on the Brooklyn Group list narrows to
  // Brooklyn × Interested, not all clients × Interested.
  const activeListParam = searchParams.get("list");
  const buildHref = (slug: string) =>
    activeListParam ? `/inbox/${slug}?list=${activeListParam}` : `/inbox/${slug}`;
  const [newViewOpen, setNewViewOpen] = useState(false);
  const [renaming, setRenaming] = useState<CustomView | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pending, startTransition] = useTransition();
  // Local mirror of the views list so drag operations can update
  // ordering optimistically — the server re-syncs in the background
  // via router.refresh().
  //
  // We can NOT blindly reset from the `views` prop on every render:
  // the server-side loadViews is wrapped in a 30s ttlCache, so after
  // a drag's PATCH + router.refresh() the page can briefly re-render
  // with the OLD order and a naive prop-sync useEffect would snap
  // the tabs back into place. The pendingOrderRef tracks the order
  // the user just dragged into — we only accept a fresh `views`
  // prop once it matches that expected order (i.e. the server has
  // caught up). Cleared automatically; cleared with a 10s fallback
  // in case a PATCH failed silently and the order never caught up.
  const [orderedViews, setOrderedViews] = useState<CustomView[]>(views);
  const pendingOrderRef = useRef<string | null>(null);
  useEffect(() => {
    const propOrder = views.map((v) => v.id).join(",");
    if (pendingOrderRef.current && pendingOrderRef.current !== propOrder) {
      // Server hasn't caught up yet — keep showing the optimistic
      // post-drag order instead of snapping back.
      return;
    }
    pendingOrderRef.current = null;
    setOrderedViews(views);
  }, [views]);

  async function deleteView(v: CustomView) {
    if (!confirm(`Delete "${v.name}" view?`)) return;
    const res = await fetch(`/api/custom-views/${v.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Delete failed");
      return;
    }
    startTransition(() => {
      router.refresh();
      // If we just deleted the view we were on, fall back to the first
      // remaining view (or the index page if none left).
      if (pathname.startsWith(`/inbox/${v.slug}`)) {
        router.push("/inbox");
      }
    });
  }

  async function commitRename() {
    if (!renaming || !renameValue.trim()) return;
    const res = await fetch(`/api/custom-views/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (!res.ok) {
      alert("Rename failed");
      return;
    }
    setRenaming(null);
    startTransition(() => router.refresh());
  }

  // Sensors: pointer drag with a tiny activation distance so a normal
  // click on a tab still navigates (only a real drag-by-X-px starts a
  // reorder). Keyboard support too — Tab to a view, Space to grab,
  // arrows to move, Space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // System / preset views (is_system=true: All Email, Open Responses,
  // etc.) stay pinned to the left and are NOT draggable. Only the
  // user-created custom views can be reordered.
  const systemViews = orderedViews.filter((v) => v.is_system);
  const userViews = orderedViews.filter((v) => !v.is_system);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = userViews.findIndex((v) => v.id === active.id);
    const newIndex = userViews.findIndex((v) => v.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(userViews, oldIndex, newIndex);
    // Optimistic UI: update local order immediately. Persist sort_order
    // to each moved view in parallel; sort_order values keep system
    // views packed at the front of the global ordering.
    const sysCount = systemViews.length;
    const previous = orderedViews;
    const nextOrdered = [...systemViews, ...reordered];
    // Mark this order as "pending server confirmation" so the
    // prop-sync useEffect above doesn't snap back to the stale
    // order during the PATCH window.
    pendingOrderRef.current = nextOrdered.map((v) => v.id).join(",");
    setOrderedViews(nextOrdered);

    // Persist EVERY non-system view's sort_order, not just the moved
    // pair — gaps in numbering can break ordering invariants on the
    // read side, and writing all of them is still cheap (<= ~30 PATCHes).
    const results = await Promise.allSettled(
      reordered.map((v, i) =>
        fetch(`/api/custom-views/${v.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: sysCount + i }),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.text().catch(() => "");
            throw new Error(`${r.status}: ${body.slice(0, 120)}`);
          }
          return r;
        }),
      ),
    );
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      // Roll back optimistic order so the user isn't left with a
      // visible state the server doesn't agree with.
      console.error("[tab-bar] reorder PATCH failed", failures);
      toast.error(
        failures.length === reordered.length
          ? "Couldn't save the new tab order"
          : `Saved ${reordered.length - failures.length} of ${reordered.length} tabs`,
      );
      pendingOrderRef.current = null;
      setOrderedViews(previous);
      return;
    }
    router.refresh();
  }

  return (
    <div className="h-12 shrink-0 border-b bg-background flex items-center pl-4 pr-2">
      <div className="flex items-stretch gap-0 overflow-x-auto no-scrollbar -mb-px">
        {systemViews.map((view) => (
          <TabItem
            key={view.id}
            view={view}
            isActive={view.slug === activeSlug}
            buildHref={buildHref}
            viewCounts={viewCounts}
            onRename={(v) => {
              setRenaming(v);
              setRenameValue(v.name);
            }}
            onDelete={deleteView}
            pending={pending}
            draggable={false}
          />
        ))}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={userViews.map((v) => v.id)}
            strategy={horizontalListSortingStrategy}
          >
            {userViews.map((view) => (
              <SortableTabItem
                key={view.id}
                view={view}
                isActive={view.slug === activeSlug}
                buildHref={buildHref}
                viewCounts={viewCounts}
                onRename={(v) => {
                  setRenaming(v);
                  setRenameValue(v.name);
                }}
                onDelete={deleteView}
                pending={pending}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          type="button"
          onClick={() => setNewViewOpen(true)}
          className="flex items-center justify-center size-9 ml-1 my-auto rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="New tab"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
      </div>
      <NewViewDialog open={newViewOpen} onOpenChange={setNewViewOpen} labels={labels} />

      <Dialog open={renaming !== null} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={commitRename} disabled={!renameValue.trim() || pending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TabItemProps {
  view: CustomView;
  isActive: boolean;
  buildHref: (slug: string) => string;
  viewCounts: Record<string, { unseen: number; pct: number | null }>;
  onRename: (v: CustomView) => void;
  onDelete: (v: CustomView) => void;
  pending: boolean;
}

// Non-sortable tab — used for system / preset views that stay pinned
// to the left of the strip. Identical content to SortableTabItem,
// just without the drag handle wiring.
function TabItem({
  view,
  isActive,
  buildHref,
  viewCounts,
  onRename,
  onDelete,
  pending,
  draggable,
}: TabItemProps & { draggable: boolean }) {
  return (
    <div className="relative flex items-stretch">
      <Link
        href={buildHref(view.slug)}
        className={cn(
          "group flex items-center gap-1.5 px-3 h-12 text-[13.5px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap",
          isActive && "text-foreground",
        )}
      >
        {draggable ? (
          <GripVertical
            className="size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            aria-hidden="true"
          />
        ) : null}
        <span>{view.name}</span>
        <CountPill
          n={viewCounts[view.id]?.unseen ?? 0}
          pct={viewCounts[view.id]?.pct ?? null}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="View actions"
                className={cn(
                  "size-4 rounded-sm flex items-center justify-center text-muted-foreground/60 hover:bg-accent",
                  !isActive && "opacity-0 group-hover:opacity-100 transition-opacity",
                )}
                onClick={(e) => e.preventDefault()}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="text-sm">
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                onRename(view);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                onDelete(view);
              }}
              disabled={pending}
              className="text-red-600 focus:text-red-600"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {isActive ? (
          <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-foreground rounded-t" />
        ) : null}
      </Link>
    </div>
  );
}

// Sortable wrapper around the tab content — the whole pill is the drag
// surface (no separate handle column). The pointer sensor's distance:4
// activation guard means a normal click still navigates; you have to
// drag at least 4px to start a reorder.
function SortableTabItem(props: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.view.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TabItem {...props} draggable />
    </div>
  );
}

function CountPill({ n, pct }: { n: number; pct: number | null }) {
  if (!n && pct === null) return null;
  // Cap visible count at 99+; same UX as the screenshot reference.
  const label = n > 99 ? "99+ new" : `${n} new`;
  return (
    <span className="ml-0.5 inline-flex items-center gap-1 whitespace-nowrap">
      {n > 0 ? (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-semibold leading-none">
          {label}
        </span>
      ) : null}
      {pct !== null ? (
        <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
          {pct}%
        </span>
      ) : null}
    </span>
  );
}
