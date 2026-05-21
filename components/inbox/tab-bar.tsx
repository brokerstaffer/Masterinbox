"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
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

  return (
    <div className="h-12 shrink-0 border-b bg-background flex items-center pl-4 pr-2">
      <div className="flex items-stretch gap-0 overflow-x-auto no-scrollbar -mb-px">
        {views.map((view) => {
          const isActive = view.slug === activeSlug;
          return (
            <div key={view.id} className="relative flex items-stretch">
              <Link
                href={buildHref(view.slug)}
                className={cn(
                  "group flex items-center gap-1.5 px-3 h-12 text-[13.5px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap",
                  isActive && "text-foreground",
                )}
              >
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
                        setRenaming(view);
                        setRenameValue(view.name);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault();
                        deleteView(view);
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
        })}
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
