"use client";

import { useState } from "react";
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

  return (
    <aside className="w-[232px] shrink-0 border-r bg-background flex flex-col">
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
