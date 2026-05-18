"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface RailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (path: string) => boolean;
}

// Keep this list trimmed to routes that actually exist. Adding a new
// destination here triggers Next.js to RSC-prefetch it on render — a
// missing page produces a stream of 404s in the browser console.
const top: RailItem[] = [
  {
    href: "/inbox",
    label: "Inbox",
    icon: Inbox,
    match: (p) =>
      p === "/" ||
      p.startsWith("/inbox") ||
      p.startsWith("/archive") ||
      p.startsWith("/spam") ||
      p.startsWith("/trash") ||
      p.startsWith("/reminders"),
  },
];

const bottom: RailItem[] = [
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    match: (p) => p.startsWith("/settings"),
  },
];

export function IconRail() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col items-center w-[60px] shrink-0 border-r bg-background py-3 gap-0.5">
      <Link
        href="/inbox"
        prefetch={false}
        className="size-9 rounded-md flex items-center justify-center text-zinc-900 hover:bg-accent transition-colors mb-2"
        aria-label="Home"
      >
        <Inbox className="size-5" strokeWidth={2.2} />
      </Link>
      <div className="flex-1 flex flex-col items-center gap-0.5">
        {top.slice(1).map((item) => (
          <RailButton key={item.href} item={item} active={isActive(item, pathname)} />
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        {bottom.map((item) => (
          <RailButton key={item.href} item={item} active={isActive(item, pathname)} />
        ))}
      </div>
    </aside>
  );
}

function isActive(item: RailItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function RailButton({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={item.href}
            prefetch={false}
            aria-label={item.label}
            className={cn(
              "size-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
              active && "bg-accent text-foreground",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={2} />
          </Link>
        }
      />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
