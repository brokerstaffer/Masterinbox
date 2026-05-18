"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Mail, BriefcaseBusiness, Paperclip, ChevronLeft, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { LabelChip } from "@/components/inbox/label-chip";
import { BulkActionsBar } from "@/components/inbox/bulk-actions-bar";
import { cn } from "@/lib/utils";
import type { ThreadRow } from "@/lib/inbox/threads";
import type { LabelRow } from "@/lib/inbox/labels-shared";
import type { ListRow } from "@/lib/inbox/lists-shared";

// Preserve the thread-list scroll position across navigations (open a
// thread → page re-mounts → list defaulted to scrollTop=0). Persist per
// basePath so different views don't collide.
function useScrollMemory(basePath: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = `threadlist-scroll:${basePath}`;
    const stored = sessionStorage.getItem(key);
    const el = ref.current;
    if (el && stored) {
      const n = Number(stored);
      if (Number.isFinite(n)) el.scrollTop = n;
    }
    const onScroll = () => {
      if (ref.current) sessionStorage.setItem(key, String(ref.current.scrollTop));
    };
    el?.addEventListener("scroll", onScroll, { passive: true });
    return () => el?.removeEventListener("scroll", onScroll);
  }, [basePath]);
  return ref;
}

function relativeTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ThreadList({
  threads,
  basePath,
  activeId,
  compact = false,
  labels = [],
  lists = [],
  total,
  page,
  pageSize,
}: {
  threads: ThreadRow[];
  basePath: string;
  activeId?: string;
  compact?: boolean;
  labels?: LabelRow[];
  lists?: ListRow[];
  total?: number;
  page?: number;
  pageSize?: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Track thread ids the user just opened. Optimistic so the blue dot
  // disappears on click without waiting for the server round-trip.
  const [optimisticSeen, setOptimisticSeen] = useState<Set<string>>(new Set());
  function isSeen(t: ThreadRow): boolean {
    return t.seen || optimisticSeen.has(t.id) || t.id === activeId;
  }
  function markOpened(id: string) {
    setOptimisticSeen((cur) => {
      if (cur.has(id)) return cur;
      const next = new Set(cur);
      next.add(id);
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(v: boolean) {
    if (v) setSelected(new Set(threads.map((t) => t.id)));
    else setSelected(new Set());
  }

  const selectedArray = Array.from(selected);
  const allSelected = selected.size > 0 && selected.size === threads.length;
  const scrollRef = useScrollMemory(basePath);

  if (compact) {
    return (
      <>
        <div className="h-9 shrink-0 border-b flex items-center px-3 text-[11px] text-muted-foreground gap-2">
          <CountAndRange total={total} page={page} pageSize={pageSize} shown={threads.length} />
          <div className="flex-1" />
          <PaginationControls basePath={basePath} page={page} pageSize={pageSize} total={total} compact />
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <ul>
          {threads.map((t) => {
            const active = t.id === activeId;
            const href = `${basePath}/${t.id}`;
            // Stop click propagation on the checkbox so the row's link
            // doesn't navigate when toggling selection.
            const eatClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
            };
            // Brute-force navigation via window.location.assign. Two prior
            // attempts — plain Next.js Link and Link + router.push — both
            // silently failed to navigate in production despite firing the
            // onClick handler (the optimistic "seen" dot disappeared, but
            // the page didn't change). A real browser navigation is slower
            // than SPA routing but guaranteed to work; we can revisit
            // client-side routing once the underlying root cause is found.
            const navigateOnClick = (e: React.MouseEvent) => {
              if (
                e.button !== 0 ||
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey
              ) {
                return; // let the browser handle modifier/middle clicks
              }
              e.preventDefault();
              markOpened(t.id);
              window.location.assign(href);
            };
            return (
              <li key={t.id} className="border-b">
                <a
                  href={href}
                  onClick={navigateOnClick}
                  className={cn(
                    "block px-3 py-3 hover:bg-accent/40 transition-colors",
                    active && "bg-accent",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="flex items-center gap-1.5 pt-0.5"
                      onClick={eatClick}
                    >
                      <UnseenDot seen={isSeen(t)} />
                      <Checkbox
                        checked={selected.has(t.id)}
                        onCheckedChange={() => toggle(t.id)}
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-1 text-[13px]">
                      <div className="flex items-center gap-2">
                        <ChannelIcon provider={t.channel_provider} />
                        <span className={cn("truncate flex-1", !isSeen(t) ? "font-semibold" : "font-medium")}>
                          {t.lead_full_name || t.lead_email || "Unknown"}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {relativeTime(t.last_message_at)}
                        </span>
                      </div>
                      <div className="truncate font-medium">{t.subject || "(no subject)"}</div>
                      <div className="truncate text-muted-foreground">
                        {t.last_message_preview}
                      </div>
                      {(t.source_provider || t.client_name || t.campaign_name || t.labels.length > 0) ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <SourceBadge source={t.source_provider} />
                          <ClientChip name={t.client_name} slug={t.client_slug} />
                          <CampaignChip name={t.campaign_name} />
                          {t.labels.slice(0, 2).map((l) => (
                            <LabelChip key={l.name} name={l.name} color={l.color} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Sticky select-all + bulk bar. Always rendered so users can select
          all from here; expands with action buttons when something's picked. */}
      <div className="h-11 shrink-0 border-b bg-background flex items-center px-3 sticky top-0 z-10">
        <Checkbox
          checked={allSelected}
          onCheckedChange={selectAll}
          className="ml-1"
          aria-label="Select all"
        />
        {selectedArray.length > 0 ? (
          <BulkActionsBar
            selected={selectedArray}
            onClear={() => setSelected(new Set())}
            labels={labels}
            lists={lists}
          />
        ) : (
          <CountAndRange
            total={total}
            page={page}
            pageSize={pageSize}
            shown={threads.length}
          />
        )}
        <div className="flex-1" />
        <PaginationControls basePath={basePath} page={page} pageSize={pageSize} total={total} />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <ul>
          {threads.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 px-4 h-12 border-b hover:bg-accent/40 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <UnseenDot seen={isSeen(t)} />
                <Checkbox
                  checked={selected.has(t.id)}
                  onCheckedChange={() => toggle(t.id)}
                />
              </div>
              <a
                href={`${basePath}/${t.id}`}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  markOpened(t.id);
                  window.location.assign(`${basePath}/${t.id}`);
                }}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <ChannelIcon provider={t.channel_provider} />
                <div className={cn("w-40 shrink-0 truncate text-[13px]", !isSeen(t) ? "font-semibold" : "font-medium")}>
                  {t.lead_full_name || t.lead_email || "Unknown"}
                </div>
                {(t.source_provider || t.client_name || t.campaign_name || t.labels.length > 0) ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <SourceBadge source={t.source_provider} />
                    <ClientChip name={t.client_name} slug={t.client_slug} />
                    <CampaignChip name={t.campaign_name} />
                    {t.labels.slice(0, 2).map((l) => (
                      <LabelChip key={l.name} name={l.name} color={l.color} />
                    ))}
                  </div>
                ) : null}
                <Paperclip className="size-3.5 text-muted-foreground shrink-0 opacity-0" />
                <div className={cn("text-[13px] shrink-0 max-w-[28%] truncate", !isSeen(t) ? "font-semibold" : "font-medium")}>
                  {t.subject || "(no subject)"}
                </div>
                <div className="min-w-0 flex-1 text-[13px] text-muted-foreground truncate">
                  {t.last_message_preview}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {relativeTime(t.last_message_at)}
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function UnseenDot({ seen }: { seen: boolean }) {
  return (
    <span
      className={cn(
        "size-2 rounded-full shrink-0",
        seen ? "bg-transparent" : "bg-blue-500",
      )}
      aria-hidden
    />
  );
}

function ChannelIcon({ provider }: { provider: ThreadRow["channel_provider"] }) {
  const Icon = provider === "unipile" ? BriefcaseBusiness : Mail;
  return (
    <div
      className={cn(
        "size-6 rounded flex items-center justify-center shrink-0",
        provider === "unipile" ? "bg-blue-50 text-blue-600" : "bg-zinc-100 text-zinc-600",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2} />
    </div>
  );
}

// Per-thread badge showing which outreach platform the reply came from.
// Tiny purple/indigo chips, distinct from label chips so they don't blend in.
function SourceBadge({ source }: { source: ThreadRow["source_provider"] }) {
  if (!source || source === "unipile") return null;
  const label = source === "instantly" ? "Instantly" : "EmailBison";
  const classes =
    source === "instantly"
      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
      : "bg-violet-50 text-violet-700 border-violet-200";
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap uppercase tracking-wide",
        classes,
      )}
    >
      {label}
    </span>
  );
}

// Client chip — derived from the EmailBison/Instantly campaign name at sync
// time. Renders the Corofy client this thread belongs to. "Unknown" gets a
// muted treatment so real clients pop visually.
function ClientChip({ name, slug }: { name: string | null; slug: string | null }) {
  if (!name) return null;
  const isUnknown = slug === "unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap",
        isUnknown
          ? "bg-zinc-50 text-zinc-500 border-zinc-200"
          : "bg-amber-50 text-amber-800 border-amber-200",
      )}
      title={`Client: ${name}`}
    >
      {name}
    </span>
  );
}

// Raw campaign name as stored on the provider. Long, so we truncate to a
// reasonable display width and rely on the title tooltip for the full name.
function CampaignChip({ name }: { name: string | null }) {
  if (!name) return null;
  const truncated = name.length > 32 ? name.slice(0, 30) + "…" : name;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap bg-sky-50 text-sky-700 border-sky-200 max-w-[14rem] truncate"
      title={`Campaign: ${name}`}
    >
      {truncated}
    </span>
  );
}

// Header label — "Showing 1-100 of 4,373" / "100 conversations" / etc.
function CountAndRange({
  total,
  page,
  pageSize,
  shown,
}: {
  total?: number;
  page?: number;
  pageSize?: number;
  shown: number;
}) {
  if (typeof total !== "number") {
    return (
      <span className="ml-3 text-xs text-muted-foreground">
        {shown} {shown === 1 ? "conversation" : "conversations"}
      </span>
    );
  }
  const p = page ?? 1;
  const size = pageSize ?? shown;
  const start = total === 0 ? 0 : (p - 1) * size + 1;
  const end = Math.min(p * size, total);
  return (
    <span className="ml-3 text-xs text-muted-foreground tabular-nums">
      {total === 0
        ? "0 conversations"
        : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
    </span>
  );
}

// Prev/Next buttons that preserve every other query param (filter, list,
// etc.) and just bump the `page` parameter.
function PaginationControls({
  basePath,
  page,
  pageSize,
  total,
  compact = false,
}: {
  basePath: string;
  page?: number;
  pageSize?: number;
  total?: number;
  compact?: boolean;
}) {
  void basePath;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (typeof total !== "number" || typeof pageSize !== "number") return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = page ?? 1;
  if (totalPages <= 1) return null;

  function href(targetPage: number): string {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (targetPage <= 1) next.delete("page");
    else next.set("page", String(targetPage));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const prevDisabled = cur <= 1;
  const nextDisabled = cur >= totalPages;
  const size = compact ? "size-6" : "size-7";

  return (
    <div className="flex items-center gap-1 mr-1">
      <span className={cn("text-xs text-muted-foreground tabular-nums mr-1", compact && "text-[11px]")}>
        Page {cur} / {totalPages}
      </span>
      <a
        href={prevDisabled ? "#" : href(cur - 1)}
        aria-label="Previous page"
        aria-disabled={prevDisabled}
        tabIndex={prevDisabled ? -1 : 0}
        className={cn(
          size,
          "rounded-md inline-flex items-center justify-center border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
          prevDisabled && "opacity-40 pointer-events-none",
        )}
      >
        <ChevronLeft className="size-3.5" />
      </a>
      <a
        href={nextDisabled ? "#" : href(cur + 1)}
        aria-label="Next page"
        aria-disabled={nextDisabled}
        tabIndex={nextDisabled ? -1 : 0}
        className={cn(
          size,
          "rounded-md inline-flex items-center justify-center border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
          nextDisabled && "opacity-40 pointer-events-none",
        )}
      >
        <ChevronRight className="size-3.5" />
      </a>
    </div>
  );
}
