"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Eye,
  Plus,
  Clock,
  Archive,
  Trash2,
  Building2,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { CreateListDialog } from "@/components/inbox/create-list-dialog";
import type { SessionContext } from "@/lib/auth/workspace";
import type { ListRow } from "@/lib/inbox/lists-shared";

// Sidebar width is user-resizable via the drag handle on the right edge.
// Width is persisted in localStorage so the user's preference survives reloads
// (and tab switches). Server-rendered default matches DEFAULT_WIDTH so the
// first paint is stable; useEffect then restores any saved value.
const SIDEBAR_WIDTH_KEY = "sales-inbox-sidebar-width";
const DEFAULT_WIDTH = 232;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

const inboxLists: Array<{ href: string; label: string; icon: LucideIcon; iconClassName?: string }> = [
  { href: "/inbox/all-email", label: "All", icon: Eye, iconClassName: "text-foreground" },
];

const folderLinks: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/reminders", label: "Reminders", icon: Clock },
  // These match the special view names handled in loadThreads (status filters).
  { href: "/inbox/archive", label: "Archive", icon: Archive },
  { href: "/inbox/trash", label: "Trash", icon: Trash2 },
];

export function Sidebar({ session, lists }: { session: SessionContext; lists: ListRow[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeListId = searchParams.get("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Mirror the latest width into a ref so the pointer-up handler can read it
  // without re-binding the effect on every width change.
  const widthRef = useRef(width);
  widthRef.current = width;

  // Restore persisted width on mount. Done in useEffect (not in useState's
  // lazy initializer) so the server-rendered HTML matches the first client
  // paint — avoids the React hydration mismatch warning.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (!saved) return;
      const n = Number(saved);
      if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) {
        setWidth(n);
      }
    } catch {
      // localStorage can throw in private-mode Safari; ignore.
    }
  }, []);

  // Global pointer handlers active only while dragging. Listening on window
  // (not the handle) so the drag keeps tracking even if the cursor moves
  // outside the 4px strip — same pattern as native window-resize handles.
  useEffect(() => {
    if (!resizing) return;

    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, d.startWidth + (e.clientX - d.startX)),
      );
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
      dragRef.current = null;
      try {
        // Persist on release, not every move, so localStorage doesn't get
        // hammered during the drag.
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
      } catch {
        // localStorage can throw in private-mode Safari; ignore.
      }
    }

    // Pin the cursor + suppress text selection across the whole page while
    // dragging — otherwise the cursor flickers back to default when the
    // pointer briefly leaves the thin handle strip.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
    // Stop text selection during drag.
    e.preventDefault();
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative shrink-0 border-r bg-background flex flex-col"
    >
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <span className="text-base">📈</span>
        <h2 className="text-sm font-semibold tracking-tight">Sales inbox</h2>
      </div>

      <nav className="px-2 flex flex-col gap-px">
        {inboxLists.map((item) => {
          const Icon = item.icon;
          const active = (pathname === item.href || pathname.startsWith(`${item.href}/`)) && !activeListId;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13.5px] font-medium text-foreground/80 hover:bg-accent hover:text-foreground transition-colors",
                active && "bg-accent text-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", item.iconClassName)} strokeWidth={2} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {lists.map((list) => {
          const active = activeListId === list.id;
          return (
            <Link
              key={list.id}
              href={`/inbox/all-email?list=${list.id}`}
              className={cn(
                "group flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13.5px] font-medium text-foreground/80 hover:bg-accent hover:text-foreground transition-colors",
                active && "bg-accent text-foreground",
              )}
            >
              <span className="text-base leading-none shrink-0">{list.icon ?? "📁"}</span>
              <span className="truncate">{list.name}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
        >
          <Plus className="size-4 shrink-0" strokeWidth={2} />
          <span>Create list item</span>
        </button>
      </nav>

      <div className="flex-1" />

      <nav className="px-2 pb-2 flex flex-col gap-px">
        {folderLinks.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13.5px] text-foreground/80 hover:bg-accent hover:text-foreground transition-colors",
                active && "bg-accent text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t">
        <WorkspaceBadge session={session} />
        <LogoutButton />
      </div>

      <CreateListDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Resize handle — sits flush against the right border. A 6px-wide hit
          target so it's easy to grab without being visually heavy. */}
      <div
        onPointerDown={onHandlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        className={cn(
          "absolute top-0 right-0 h-full w-1.5 -mr-px cursor-col-resize select-none z-10",
          "hover:bg-accent/60 transition-colors",
          resizing && "bg-accent",
        )}
      />
    </aside>
  );
}

function WorkspaceBadge({ session }: { session: SessionContext }) {
  return (
    <div className="w-full flex items-center gap-2 px-3 py-2 text-[13px]">
      <Building2 className="size-4 text-muted-foreground" strokeWidth={2} />
      <span className="truncate flex-1 text-left font-medium">
        {session.activeWorkspace.name}
      </span>
    </div>
  );
}

function LogoutButton() {
  async function onLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button
      type="button"
      onClick={onLogout}
      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
    >
      <LogOut className="size-4 text-muted-foreground" strokeWidth={2} />
      <span>Logout</span>
    </button>
  );
}
