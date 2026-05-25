"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Workflow, UserCheck, Ban, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PortalLogo } from "@/components/portals/portal-logo";

interface Props {
  token: string;
  clientName: string;
  counts: { pipeline: number; dnc: number; agents: number; team: number };
  children: React.ReactNode;
}

// Sidebar shell for every page under /portal/[token]/. Recruiting
// Pipeline lives at the portal root — it merges what used to be a
// separate Introductions surface with the per-row stage tracker
// (see migration 0027 + app/portal/[token]/page.tsx).
export function PortalShell({ token, clientName, counts, children }: Props) {
  const pathname = usePathname();
  const base = `/portal/${token}`;

  const items = [
    { href: base, label: "Recruiting Pipeline", icon: Workflow, count: counts.pipeline },
    { href: `${base}/agents`, label: "Your Agents", icon: UserCheck, count: counts.agents },
    { href: `${base}/dnc`, label: "DNC List", icon: Ban, count: counts.dnc, tone: "danger" as const },
    { href: `${base}/team`, label: "Team", icon: Users, count: counts.team },
  ];

  return (
    <div className="flex min-h-screen bg-[#f6f7f9] text-[#0f1320] antialiased">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-[#ebecf0] bg-white">
        <div className="flex items-center gap-2.5 border-b border-[#ebecf0] px-5 py-4">
          <PortalLogo className="size-7" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-tight tracking-tight">
              {clientName}
            </div>
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-[#9aa0ab]">
              Client Portal
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-px p-2">
          {items.map((it) => {
            const active = isActive(pathname, it.href, base);
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-[#eaf2fd] text-[#1565C0]"
                    : "text-[#5b6472] hover:bg-[#f6f7f9] hover:text-[#0f1320]",
                )}
              >
                <Icon
                  className={cn(
                    "size-[15px] shrink-0",
                    active ? "text-[#1565C0]" : "text-[#9aa0ab] group-hover:text-[#5b6472]",
                  )}
                  strokeWidth={2}
                />
                <span className="truncate">{it.label}</span>
                {typeof it.count === "number" && it.count > 0 ? (
                  <span
                    className={cn(
                      "ml-auto inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                      it.tone === "danger"
                        ? "bg-[#fee2e2] text-[#b91c1c]"
                        : active
                          ? "bg-white text-[#1565C0]"
                          : "bg-[#eef0f3] text-[#5b6472]",
                    )}
                  >
                    {it.count > 99 ? "99+" : it.count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-[#ebecf0] px-5 py-3 text-[11px] text-[#9aa0ab]">
          Powered by Corofy
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function isActive(pathname: string | null, href: string, base: string): boolean {
  if (!pathname) return false;
  if (href === base) {
    // Recruiting Pipeline = portal root. The legacy /pipeline sub-route
    // redirects here, so highlight on either path.
    return (
      pathname === base ||
      pathname === `${base}/` ||
      pathname === `${base}/pipeline` ||
      pathname === `${base}/pipeline/`
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
