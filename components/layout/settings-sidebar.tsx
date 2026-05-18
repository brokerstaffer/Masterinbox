"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavSection {
  label: string;
  items: Array<{ href: string; label: string; icon: React.ReactNode }>;
}

import {
  User,
  Users,
  Tag,
  Brain,
  Bot,
} from "lucide-react";

const sections: NavSection[] = [
  {
    label: "Account settings",
    items: [
      { href: "/settings/personal", label: "Personal details", icon: <User className="size-4" strokeWidth={2} /> },
    ],
  },
  {
    label: "Workspace settings",
    items: [
      { href: "/settings/members",      label: "Members",       icon: <Users className="size-4" strokeWidth={2} /> },
      { href: "/settings/labels",       label: "Labels",        icon: <Tag className="size-4" strokeWidth={2} /> },
      { href: "/settings/ai-labeling",  label: "AI Labeling",   icon: <Brain className="size-4" strokeWidth={2} /> },
      { href: "/settings/reply-agents", label: "Reply Agents",  icon: <Bot className="size-4" strokeWidth={2} /> },
    ],
  },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[232px] shrink-0 border-r bg-background flex flex-col overflow-y-auto">
      {sections.map((section) => (
        <div key={section.label} className="py-3">
          <p className="px-4 pb-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            {section.label}
          </p>
          <nav className="px-2 flex flex-col gap-px">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13.5px] text-foreground/80 hover:bg-accent hover:text-foreground transition-colors",
                    active && "bg-accent text-foreground font-medium",
                  )}
                >
                  <span className="text-muted-foreground shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </aside>
  );
}
