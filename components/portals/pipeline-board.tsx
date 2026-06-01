"use client";

import { useMemo, useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Check,
  Search,
  StickyNote,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Download,
  Phone as PhoneIcon,
  MessageSquare,
  Globe,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type PipelineEntry,
  type PipelineStage,
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/lib/portals/portal-data";
import {
  PortalEmpty,
  Avatar,
  useMounted,
} from "@/components/portals/portal-ui";
import { PipelineDetailInline } from "@/components/portals/pipeline-detail-inline";
import { formatPhoneDisplay } from "@/lib/portals/phone";

// Stage → coloured chip. Tone matches the Google Sheets pipeline board:
// saturated fill, white text — readable at a glance across a long table.
const STAGE_STYLE: Record<PipelineStage, { bg: string; text: string }> = {
  introduction:    { bg: "bg-[#1976d2]", text: "text-white" },
  phone_screen:    { bg: "bg-[#4f63d2]", text: "text-white" },
  interview:       { bg: "bg-[#7c4dff]", text: "text-white" },
  hired:           { bg: "bg-[#10a05d]", text: "text-white" },
  keep_warm:       { bg: "bg-[#f5a623]", text: "text-white" },
  we_they_rejected:{ bg: "bg-[#e23a3a]", text: "text-white" },
  no_show:         { bg: "bg-[#8b95a3]", text: "text-white" },
};

type EditTarget = { mode: "create" } | { mode: "edit"; entry: PipelineEntry };

export function PipelineBoard({
  token,
  entries: initial,
}: {
  token: string;
  entries: PipelineEntry[];
}) {
  const router = useRouter();
  const mounted = useMounted();
  // Local copy lets us update optimistically — the server is the source
  // of truth on the next router.refresh().
  const [entries, setEntries] = useState(initial);
  useEffect(() => setEntries(initial), [initial]);

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<Set<PipelineStage>>(new Set());
  const [replaceOnly, setReplaceOnly] = useState(false);
  const [openNotes, setOpenNotes] = useState<PipelineEntry | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (stageFilter.size > 0 && !stageFilter.has(e.stage)) return false;
      if (replaceOnly && e.stage !== "no_show") return false;
      if (q) {
        const hay = [e.lead_name, e.lead_email, e.current_brokerage, e.lead_phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, stageFilter, replaceOnly]);

  // Per-stage counts for the filter chips.
  const stageCounts = useMemo(() => {
    const m: Record<PipelineStage, number> = {
      introduction: 0,
      phone_screen: 0,
      interview: 0,
      hired: 0,
      keep_warm: 0,
      we_they_rejected: 0,
      no_show: 0,
    };
    for (const e of entries) m[e.stage] += 1;
    return m;
  }, [entries]);

  async function patch(id: string, body: Partial<PipelineEntry>) {
    const res = await fetch(`/api/portal/${token}/pipeline/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Update failed");
      router.refresh();
      return false;
    }
    return true;
  }

  function toggleStageFilter(s: PipelineStage) {
    setStageFilter((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function changeStage(id: string, stage: PipelineStage) {
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, stage } : e)));
    void patch(id, { stage });
  }

  function applyEntryEdit(id: string, patchEdits: Partial<PipelineEntry>) {
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...patchEdits } : e)));
  }

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((e) => e.id)));
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} candidate${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    setEntries((cur) => cur.filter((e) => !selected.has(e.id)));
    setSelected(new Set());
    const res = await fetch(`/api/portal/${token}/pipeline`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids }),
    });
    setBulkBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Bulk delete failed");
      router.refresh();
      return;
    }
    toast.success(`${ids.length} candidate${ids.length === 1 ? "" : "s"} removed`);
  }

  async function bulkStage(stage: PipelineStage) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    setEntries((cur) => cur.map((e) => (selected.has(e.id) ? { ...e, stage } : e)));
    setSelected(new Set());
    const res = await fetch(`/api/portal/${token}/pipeline`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stage", ids, stage }),
    });
    setBulkBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Bulk stage update failed");
      router.refresh();
      return;
    }
    toast.success(`Moved ${ids.length} to ${STAGE_LABELS[stage]}`);
  }

  function bulkExport() {
    const rows = selected.size > 0
      ? entries.filter((e) => selected.has(e.id))
      : filtered;
    if (rows.length === 0) return;
    const cols = [
      "Name",
      "Email",
      "Phone",
      "Company",
      "Website",
      "Location",
      "Stage",
      "Introduced",
    ];
    const lines = [cols.join(",")];
    for (const r of rows) {
      const row = [
        r.lead_name ?? "",
        r.lead_email ?? "",
        r.lead_phone ?? "",
        r.current_brokerage ?? "",
        r.agent_profile_url ?? "",
        r.lead_location ?? "",
        STAGE_LABELS[r.stage],
        r.introduced_at ? new Date(r.introduced_at).toISOString().slice(0, 10) : "",
      ];
      lines.push(row.map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCount = entries.length;
  const hiredCount = stageCounts.hired;
  const lastIntroAt = useMemo(() => {
    let max: string | null = null;
    for (const e of entries) {
      if (!e.introduced_at) continue;
      if (!max || e.introduced_at > max) max = e.introduced_at;
    }
    return max;
  }, [entries]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6">
      <LiveTiles total={totalCount} hired={hiredCount} lastIntroAt={lastIntroAt} />

      {entries.length === 0 ? (
        <div className="space-y-3">
          <PortalEmpty
            title="No introductions yet"
            hint="New candidates appear here automatically as introductions land in the inbox. You can also add one manually."
          />
          <div className="flex justify-center">
            <Button onClick={() => setEditTarget({ mode: "create" })}>
              <Plus className="mr-1.5 size-4" /> Add a candidate
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Filter row */}
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9aa0ab]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search candidates…"
                  className="h-9 w-full rounded-lg border border-[#ebecf0] bg-white pl-8 pr-3 text-[13px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd] sm:w-64"
                />
              </div>
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-[#ebecf0] bg-white px-3 text-[13px] text-[#5b6472]">
                <input
                  type="checkbox"
                  checked={replaceOnly}
                  onChange={(e) => setReplaceOnly(e.target.checked)}
                  className="size-3.5 accent-[#1565C0]"
                />
                Replacements only
              </label>
              <Button
                size="sm"
                onClick={() => setEditTarget({ mode: "create" })}
                className="h-9"
              >
                <Plus className="mr-1 size-4" /> Add lead
              </Button>
              <span className="ml-auto text-[12px] text-[#9aa0ab]">
                {filtered.length} of {entries.length} candidates
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STAGE_ORDER.map((s) => {
                const active = stageFilter.has(s);
                const style = STAGE_STYLE[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStageFilter(s)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all",
                      active
                        ? `${style.bg} ${style.text} border-transparent`
                        : "border-[#ebecf0] bg-white text-[#5b6472] hover:bg-[#f6f7f9]",
                    )}
                  >
                    {STAGE_LABELS[s]}
                    <span className={cn("tabular-nums", active ? "" : "text-[#9aa0ab]")}>
                      {stageCounts[s]}
                    </span>
                  </button>
                );
              })}
              {stageFilter.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setStageFilter(new Set())}
                  className="text-[11.5px] font-medium text-[#1565C0] hover:underline"
                >
                  Clear filter
                </button>
              ) : null}
            </div>
          </div>

          {/* Bulk-action bar — always rendered so the affordance is
              discoverable. When nothing is selected the buttons are
              disabled and the leading label nudges the user to tick a
              row. When at least one row is selected the bar lights up
              and the label switches to a live count. */}
          <div
            className={cn(
              "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12.5px] transition-colors",
              selected.size > 0
                ? "border-[#d4e4f8] bg-[#eaf2fd]"
                : "border-[#ebecf0] bg-white",
            )}
          >
            <span
              className={cn(
                "font-medium",
                selected.size > 0 ? "text-[#1565C0]" : "text-[#5b6472]",
              )}
            >
              {selected.size > 0
                ? `${selected.size} selected`
                : "Bulk actions — tick rows below to enable"}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkBusy || selected.size === 0}
                    >
                      Move to… <ChevronDown className="ml-1 size-3.5" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-48">
                  {STAGE_ORDER.map((s) => (
                    <DropdownMenuItem key={s} onClick={() => bulkStage(s)}>
                      <span className={cn("mr-2 inline-block size-2.5 rounded-full", STAGE_STYLE[s].bg)} />
                      {STAGE_LABELS[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                onClick={bulkExport}
                disabled={bulkBusy || selected.size === 0}
              >
                <Download className="mr-1 size-3.5" /> Export CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={bulkDelete}
                disabled={bulkBusy || selected.size === 0}
                className={cn(selected.size > 0 ? "text-[#e23a3a]" : "")}
              >
                <Trash2 className="mr-1 size-3.5" /> Delete
              </Button>
              {selected.size > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          {/* Table (md+) — scrolls horizontally if container shrinks. */}
          <div
            className={cn(
              "hidden overflow-hidden rounded-2xl border border-[#ebecf0] bg-white shadow-sm transition-opacity duration-500 md:block",
              mounted ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="grid grid-cols-[36px_1.4fr_1.1fr_140px_130px_200px_60px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
              <div>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="size-3.5 accent-[#1565C0]"
                />
              </div>
              <div>Candidate</div>
              <div>Company</div>
              <div>Phone</div>
              <div>Introduced</div>
              <div>Stage</div>
              <div className="text-right">Notes</div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#9aa0ab]">
                No candidates match the current filters.
              </div>
            ) : (
              <div className="divide-y divide-[#f0f1f4]">
                {filtered.map((e) => {
                  const expanded = expandedId === e.id;
                  return (
                    <div key={e.id}>
                      <PipelineRow
                        entry={e}
                        expanded={expanded}
                        selected={selected.has(e.id)}
                        onToggleSelect={() => toggleSelect(e.id)}
                        onStage={(s) => changeStage(e.id, s)}
                        onOpenNotes={() => setOpenNotes(e)}
                        onEdit={() => setEditTarget({ mode: "edit", entry: e })}
                        onToggleExpand={() =>
                          setExpandedId((cur) => (cur === e.id ? null : e.id))
                        }
                      />
                      {expanded ? (
                        <div className="border-t border-[#ebecf0] bg-[#fafbfc]">
                          <PipelineDetailInline
                            entry={e}
                            token={token}
                            onLocalUpdate={(p) => applyEntryEdit(e.id, p)}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card list (mobile). Same actions, vertical layout. */}
          <div className="space-y-3 md:hidden">
            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-[#ebecf0] bg-white p-8 text-center text-sm text-[#9aa0ab]">
                No candidates match the current filters.
              </div>
            ) : (
              filtered.map((e) => (
                <PipelineMobileCard
                  key={e.id}
                  entry={e}
                  expanded={expandedId === e.id}
                  selected={selected.has(e.id)}
                  onToggleSelect={() => toggleSelect(e.id)}
                  onStage={(s) => changeStage(e.id, s)}
                  onOpenNotes={() => setOpenNotes(e)}
                  onEdit={() => setEditTarget({ mode: "edit", entry: e })}
                  onToggleExpand={() =>
                    setExpandedId((cur) => (cur === e.id ? null : e.id))
                  }
                  token={token}
                  onLocalUpdate={(p) => applyEntryEdit(e.id, p)}
                />
              ))
            )}
          </div>
        </>
      )}

      {openNotes ? (
        <NotesSheet
          token={token}
          entry={openNotes}
          onClose={() => setOpenNotes(null)}
          onApply={(notes_log) => applyEntryEdit(openNotes.id, { notes_log })}
        />
      ) : null}

      {editTarget ? (
        <EditLeadDialog
          token={token}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onApply={(idOrNew, patchEdits, full) => {
            if (editTarget.mode === "create" && full) {
              setEntries((cur) => [full, ...cur]);
            } else {
              applyEntryEdit(idOrNew, patchEdits);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function LiveTiles({
  total,
  hired,
  lastIntroAt,
}: {
  total: number;
  hired: number;
  lastIntroAt: string | null;
}) {
  // Re-derives instantly when stages move because `entries` lives in the
  // parent client component — replaces the static server-rendered tiles
  // that used to lag behind optimistic UI updates.
  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-[#d4e4f8] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
            Total introductions
          </span>
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#eaf2fd] text-[#1565C0]">
            <TrendingUp className="size-3.5" />
          </span>
        </div>
        <div className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-[#1565C0]">
          {total.toLocaleString()}
        </div>
        <div className="mt-1.5 text-[11.5px] text-[#9aa0ab]">
          {lastIntroAt
            ? `Most recent ${formatAbsolute(lastIntroAt)}`
            : "Waiting on the first intro"}
        </div>
      </div>
      <div className="rounded-2xl border border-[#ebecf0] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
            Hired
          </span>
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#f6f7f9] text-[#aab0ba]">
            <Trophy className="size-3.5" />
          </span>
        </div>
        <div className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-[#0f1320]">
          {hired.toLocaleString()}
        </div>
        <div className="mt-1.5 text-[11.5px] text-[#9aa0ab]">
          {hired > 0
            ? `${Math.round((hired / Math.max(total, 1)) * 100)}% conversion`
            : "Zero so far"}
        </div>
      </div>
    </div>
  );
}

function PipelineRow({
  entry,
  expanded,
  selected,
  onToggleSelect,
  onStage,
  onOpenNotes,
  onEdit,
  onToggleExpand,
}: {
  entry: PipelineEntry;
  expanded: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onStage: (s: PipelineStage) => void;
  onOpenNotes: () => void;
  onEdit: () => void;
  onToggleExpand: () => void;
}) {
  const phone = entry.lead_phone ?? null;
  return (
    <div
      className={cn(
        "grid grid-cols-[36px_1.4fr_1.1fr_140px_130px_200px_60px] items-start gap-3 px-4 py-3 transition-colors",
        expanded ? "bg-[#fafbfc]" : "hover:bg-[#fafbfc]",
        selected ? "bg-[#eaf2fd] hover:bg-[#eaf2fd]" : "",
      )}
    >
      <div className="pt-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="size-3.5 accent-[#1565C0]"
          aria-label="Select"
        />
      </div>
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex min-w-0 items-start gap-3 text-left"
        title={expanded ? "Hide lead details" : "Show lead details"}
        aria-expanded={expanded}
      >
        <Avatar name={entry.lead_name ?? entry.lead_email ?? "?"} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[13.5px] font-medium",
                expanded ? "text-[#1565C0]" : "hover:text-[#1565C0]",
              )}
            >
              {entry.lead_name || entry.lead_email || "Unknown"}
            </span>
            {entry.stage === "no_show" || entry.needs_replacement ? (
              <span className="rounded-full bg-[#fde8e8] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#c0392b]">
                Replacement
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "size-3 shrink-0 text-[#9aa0ab] transition-transform",
                expanded ? "rotate-180 text-[#1565C0]" : "",
              )}
            />
          </div>
          {entry.lead_email ? (
            <div className="truncate text-[11.5px] text-[#9aa0ab]">{entry.lead_email}</div>
          ) : null}
        </div>
      </button>
      <div className="min-w-0 text-[13px] text-[#5b6472]">
        <div className="truncate">{entry.current_brokerage ?? "—"}</div>
        {entry.agent_profile_url ? (
          <a
            href={normalizeUrl(entry.agent_profile_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 truncate text-[11.5px] text-[#1565C0] hover:underline"
            title={trimUrl(entry.agent_profile_url)}
          >
            <Globe className="size-3" />
            Website
          </a>
        ) : null}
        {entry.lead_location ? (
          <div className="mt-0.5 truncate text-[11.5px] text-[#9aa0ab]">{entry.lead_location}</div>
        ) : null}
      </div>
      <div className="text-[12.5px] tabular-nums text-[#5b6472]">
        {phone ? (
          <div className="flex flex-col items-start gap-0.5">
            <span>{formatPhoneDisplay(phone)}</span>
            <div className="inline-flex items-center gap-1">
              <a
                href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                className="inline-flex h-5 items-center gap-1 rounded border border-[#d4e4f8] bg-white px-1.5 text-[10.5px] font-medium text-[#1565C0] hover:bg-[#eaf2fd]"
                aria-label={`Call ${phone}`}
                title="Call"
              >
                <PhoneIcon className="size-3" />
                Call
              </a>
              <a
                href={`sms:${phone.replace(/[^+\d]/g, "")}`}
                className="inline-flex h-5 items-center gap-1 rounded border border-[#d4e4f8] bg-white px-1.5 text-[10.5px] font-medium text-[#1565C0] hover:bg-[#eaf2fd]"
                aria-label={`Text ${phone}`}
                title="Text"
              >
                <MessageSquare className="size-3" />
                Text
              </a>
            </div>
          </div>
        ) : (
          "—"
        )}
      </div>
      <div className="text-[12.5px] text-[#5b6472]">{fmtDate(entry.introduced_at)}</div>
      <div className="flex flex-col items-start gap-1.5">
        <StageSelector value={entry.stage} onChange={onStage} />
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[#d4e4f8] bg-white px-2 text-[11.5px] font-medium text-[#1565C0] hover:bg-[#eaf2fd]"
          title="Edit name, company, phone, website, intro date"
        >
          <Pencil className="size-3" />
          Edit
        </button>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onOpenNotes}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors",
            entry.notes_log.length > 0
              ? "border-[#d4e4f8] bg-[#eaf2fd] text-[#1565C0] hover:bg-[#dbe9fa]"
              : "border-[#ebecf0] bg-white text-[#9aa0ab] hover:bg-[#f6f7f9]",
          )}
          title={entry.notes_log.length > 0 ? `${entry.notes_log.length} notes` : "Add notes"}
        >
          <StickyNote className="size-3.5" />
          {entry.notes_log.length > 0 ? entry.notes_log.length : "Add"}
        </button>
      </div>
    </div>
  );
}

function PipelineMobileCard({
  entry,
  expanded,
  selected,
  onToggleSelect,
  onStage,
  onOpenNotes,
  onEdit,
  onToggleExpand,
  token,
  onLocalUpdate,
}: {
  entry: PipelineEntry;
  expanded: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onStage: (s: PipelineStage) => void;
  onOpenNotes: () => void;
  onEdit: () => void;
  onToggleExpand: () => void;
  token: string;
  onLocalUpdate: (patch: Partial<PipelineEntry>) => void;
}) {
  const phone = entry.lead_phone ?? null;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-3 shadow-sm",
        selected ? "border-[#1565C0] bg-[#eaf2fd]" : "border-[#ebecf0]",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 size-3.5 accent-[#1565C0]"
          aria-label="Select"
        />
        <Avatar name={entry.lead_name ?? entry.lead_email ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">
              {entry.lead_name || entry.lead_email || "Unknown"}
            </span>
            {entry.stage === "no_show" || entry.needs_replacement ? (
              <span className="rounded-full bg-[#fde8e8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#c0392b]">
                Replacement
              </span>
            ) : null}
          </div>
          {entry.lead_email ? (
            <div className="truncate text-[12px] text-[#9aa0ab]">{entry.lead_email}</div>
          ) : null}
          {entry.current_brokerage ? (
            <div className="mt-1 text-[12.5px] text-[#5b6472]">{entry.current_brokerage}</div>
          ) : null}
          {entry.agent_profile_url ? (
            <a
              href={normalizeUrl(entry.agent_profile_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 truncate text-[12px] text-[#1565C0] hover:underline"
              title={trimUrl(entry.agent_profile_url)}
            >
              <Globe className="size-3" />
              Website
            </a>
          ) : null}
          {entry.lead_location ? (
            <div className="text-[12px] text-[#9aa0ab]">{entry.lead_location}</div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StageSelector value={entry.stage} onChange={onStage} />
        {phone ? (
          <div className="inline-flex h-8 items-center gap-1 rounded-md border border-[#ebecf0] bg-white pl-2 pr-1 text-[12px] text-[#5b6472]">
            <span className="tabular-nums">{formatPhoneDisplay(phone)}</span>
            <a
              href={`tel:${phone.replace(/[^+\d]/g, "")}`}
              className="inline-flex size-6 items-center justify-center rounded text-[#1565C0] hover:bg-[#eaf2fd]"
              aria-label={`Call ${phone}`}
              title="Call"
            >
              <PhoneIcon className="size-3.5" />
            </a>
            <a
              href={`sms:${phone.replace(/[^+\d]/g, "")}`}
              className="inline-flex size-6 items-center justify-center rounded text-[#1565C0] hover:bg-[#eaf2fd]"
              aria-label={`Text ${phone}`}
              title="Text"
            >
              <MessageSquare className="size-3.5" />
            </a>
          </div>
        ) : null}
        <span className="text-[11.5px] text-[#9aa0ab]">
          Introduced {fmtDate(entry.introduced_at)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d4e4f8] bg-white px-2 text-[12px] font-medium text-[#1565C0]"
            title="Edit name, company, phone, website, intro date"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={onOpenNotes}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12px]",
              entry.notes_log.length > 0
                ? "border-[#d4e4f8] bg-[#eaf2fd] text-[#1565C0]"
                : "border-[#ebecf0] bg-white text-[#9aa0ab]",
            )}
          >
            <StickyNote className="size-3.5" />
            {entry.notes_log.length > 0 ? entry.notes_log.length : "Notes"}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleExpand}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[#ebecf0] py-1.5 text-[11.5px] text-[#9aa0ab]"
      >
        {expanded ? "Hide details" : "Show details"}
        <ChevronDown className={cn("size-3 transition-transform", expanded ? "rotate-180" : "")} />
      </button>
      {expanded ? (
        <div className="mt-2 rounded-lg bg-[#fafbfc]">
          <PipelineDetailInline
            entry={entry}
            token={token}
            onLocalUpdate={onLocalUpdate}
          />
        </div>
      ) : null}
    </div>
  );
}

function StageSelector({
  value,
  onChange,
}: {
  value: PipelineStage;
  onChange: (s: PipelineStage) => void;
}) {
  const style = STAGE_STYLE[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-between gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all hover:brightness-95",
              style.bg,
              style.text,
            )}
          >
            <span className="truncate">{STAGE_LABELS[value]}</span>
            <ChevronDown className="size-3 shrink-0 opacity-70" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-48">
        {STAGE_ORDER.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => onChange(s)}
            className="flex items-center justify-between gap-2"
          >
            <span className="text-[13px]">{STAGE_LABELS[s]}</span>
            {s === value ? <Check className="size-3.5 text-[#1565C0]" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Slides in from the right when the user clicks the Notes pill on a
// row. Layout: a sticky lead-summary card on top (avatar, name, the
// quick-contact bits), then the note composer + numbered note cards
// underneath. Replaces the older modal dialog so the row stays
// visually anchored on the left while notes are managed on the right.
function NotesSheet({
  token,
  entry,
  onClose,
  onApply,
}: {
  token: string;
  entry: PipelineEntry;
  onClose: () => void;
  onApply: (notes: PipelineEntry["notes_log"]) => void;
}) {
  const [notes, setNotes] = useState(entry.notes_log);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  async function addNote() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const res = await fetch(`/api/portal/${token}/pipeline/${entry.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not save note");
      return;
    }
    const j = (await res.json()) as { note: PipelineEntry["notes_log"][number] };
    const next = [j.note, ...notes];
    setNotes(next);
    onApply(next);
    setDraft("");
  }

  async function saveEdit(noteId: string) {
    const body = editDraft.trim();
    if (!body) return;
    setBusy(true);
    const res = await fetch(`/api/portal/${token}/pipeline/${entry.id}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not update note");
      return;
    }
    const next = notes.map((n) =>
      n.id === noteId ? { ...n, body, updated_at: new Date().toISOString() } : n,
    );
    setNotes(next);
    onApply(next);
    setEditing(null);
  }

  async function deleteNote(noteId: string) {
    if (!confirm("Delete this note?")) return;
    setBusy(true);
    const res = await fetch(`/api/portal/${token}/pipeline/${entry.id}/notes/${noteId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not delete note");
      return;
    }
    const next = notes.filter((n) => n.id !== noteId);
    setNotes(next);
    onApply(next);
  }

  const phone = entry.lead_phone;
  const isReplacement = entry.stage === "no_show" || entry.needs_replacement;

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* Lead summary — sticky on top so the operator always sees
            who they're noting against while they scroll the list. */}
        <header className="shrink-0 border-b border-[#ebecf0] bg-white px-5 py-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#9aa0ab]">
            Lead details
          </div>
          <div className="mt-2 flex items-start gap-3">
            <Avatar name={entry.lead_name ?? entry.lead_email ?? "?"} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[15px] font-semibold text-[#0f1320]">
                  {entry.lead_name || entry.lead_email || "Unknown"}
                </span>
                {isReplacement ? (
                  <span className="rounded-full bg-[#fde8e8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#c0392b]">
                    Replacement
                  </span>
                ) : null}
              </div>
              {entry.lead_email ? (
                <a
                  href={`mailto:${entry.lead_email}`}
                  className="block truncate text-[12px] text-[#1565C0] hover:underline"
                >
                  {entry.lead_email}
                </a>
              ) : null}
            </div>
          </div>
          {/* Two-column meta grid. Each cell stays compact so the
              header doesn't eat the available vertical space. */}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
            {phone ? (
              <div className="col-span-2">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
                  Phone
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <span className="tabular-nums text-[#0f1320]">{formatPhoneDisplay(phone)}</span>
                  <a
                    href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                    className="inline-flex h-6 items-center gap-1 rounded border border-[#d4e4f8] bg-white px-1.5 text-[10.5px] font-medium text-[#1565C0] hover:bg-[#eaf2fd]"
                    title="Call"
                  >
                    <PhoneIcon className="size-3" />
                    Call
                  </a>
                  <a
                    href={`sms:${phone.replace(/[^+\d]/g, "")}`}
                    className="inline-flex h-6 items-center gap-1 rounded border border-[#d4e4f8] bg-white px-1.5 text-[10.5px] font-medium text-[#1565C0] hover:bg-[#eaf2fd]"
                    title="Text"
                  >
                    <MessageSquare className="size-3" />
                    Text
                  </a>
                </dd>
              </div>
            ) : null}
            {entry.current_brokerage ? (
              <div>
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
                  Company
                </dt>
                <dd className="mt-0.5 truncate text-[#0f1320]">
                  {entry.current_brokerage}
                </dd>
              </div>
            ) : null}
            {entry.lead_location ? (
              <div>
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
                  Location
                </dt>
                <dd className="mt-0.5 truncate text-[#0f1320]">
                  {entry.lead_location}
                </dd>
              </div>
            ) : null}
            {entry.agent_profile_url ? (
              <div className="col-span-2">
                <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
                  Website
                </dt>
                <dd className="mt-0.5">
                  <a
                    href={normalizeUrl(entry.agent_profile_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 truncate text-[#1565C0] hover:underline"
                  >
                    <Globe className="size-3" />
                    {trimUrl(entry.agent_profile_url)}
                  </a>
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
                Stage
              </dt>
              <dd className="mt-0.5 text-[#0f1320]">{STAGE_LABELS[entry.stage]}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
                Introduced
              </dt>
              <dd className="mt-0.5 text-[#0f1320]">{fmtDate(entry.introduced_at)}</dd>
            </div>
          </dl>
        </header>

        {/* Notes section — scrolls independently of the lead summary. */}
        <div className="flex min-h-0 flex-1 flex-col bg-[#fafbfc]">
          <div className="shrink-0 px-5 pt-4">
            <div className="flex items-baseline justify-between">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#9aa0ab]">
                Notes
              </div>
              <div className="text-[11px] text-[#9aa0ab]">
                {notes.length} {notes.length === 1 ? "entry" : "entries"}
              </div>
            </div>
            <div className="mt-2 rounded-xl border border-[#ebecf0] bg-white p-2 shadow-sm">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a new note…"
                rows={3}
                className="resize-y border-0 bg-transparent p-1 text-[13px] focus-visible:ring-0"
              />
              <div className="flex justify-end">
                <Button onClick={addNote} disabled={busy || !draft.trim()} size="sm">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Add note"}
                </Button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {notes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#ebecf0] bg-white px-4 py-8 text-center text-[12.5px] text-[#9aa0ab]">
                No notes yet. Add the first one above.
              </div>
            ) : (
              <ol className="space-y-3">
                {notes.map((n, i) => (
                  <li
                    key={n.id}
                    className="relative rounded-xl border border-[#ebecf0] bg-white p-3 pl-12 shadow-sm"
                  >
                    {/* Numbered marker so operators can refer to notes
                        in order ("see note 2 from last week"). */}
                    <span className="absolute left-3 top-3 inline-flex size-7 items-center justify-center rounded-full bg-[#eaf2fd] text-[12px] font-semibold text-[#1565C0]">
                      {i + 1}
                    </span>
                    {editing === n.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          className="text-[13px]"
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => saveEdit(n.id)} disabled={busy}>
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-[11px] text-[#9aa0ab]">
                          {fmtDateTime(n.created_at)}
                          {n.updated_at && n.updated_at !== n.created_at
                            ? ` · edited ${fmtDateTime(n.updated_at)}`
                            : ""}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#0f1320]">
                          {n.body}
                        </p>
                        <div className="mt-2 flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(n.id);
                              setEditDraft(n.body);
                            }}
                            className="inline-flex h-6 items-center gap-1 rounded border border-[#ebecf0] bg-white px-2 text-[11px] font-medium text-[#5b6472] hover:bg-[#f6f7f9]"
                          >
                            <Pencil className="size-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteNote(n.id)}
                            className="inline-flex h-6 items-center gap-1 rounded border border-[#fbd9d4] bg-white px-2 text-[11px] font-medium text-[#c0392b] hover:bg-[#fef0ee]"
                          >
                            <Trash2 className="size-3" />
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EditLeadDialog({
  token,
  target,
  onClose,
  onApply,
}: {
  token: string;
  target: EditTarget;
  onClose: () => void;
  onApply: (
    idOrNew: string,
    patchEdits: Partial<PipelineEntry>,
    fullNew?: PipelineEntry,
  ) => void;
}) {
  const initial = target.mode === "edit" ? target.entry : null;
  const [name, setName] = useState(initial?.lead_name ?? "");
  const [email, setEmail] = useState(initial?.lead_email ?? "");
  const [phone, setPhone] = useState(initial?.lead_phone ?? "");
  const [company, setCompany] = useState(initial?.current_brokerage ?? "");
  const [website, setWebsite] = useState(initial?.agent_profile_url ?? "");
  const [introducedAt, setIntroducedAt] = useState<string>(
    initial?.introduced_at
      ? toLocalDateInput(initial.introduced_at)
      : toLocalDateInput(new Date().toISOString()),
  );
  // Manual "Replacement" tag. The pill renders whenever this flag is
  // true OR the stage is No-Show; this checkbox is how the client
  // flips it on for leads in any other stage.
  const [needsReplacement, setNeedsReplacement] = useState<boolean>(
    initial?.needs_replacement ?? false,
  );
  const [pending, startTransition] = useTransition();

  async function submit() {
    const body = {
      lead_name: name.trim() || null,
      lead_email: email.trim() || null,
      lead_phone: phone.trim() || null,
      current_brokerage: company.trim() || null,
      agent_profile_url: website.trim() || null,
      introduced_at: introducedAt
        ? new Date(introducedAt + "T12:00:00Z").toISOString()
        : null,
      needs_replacement: needsReplacement,
    };
    if (target.mode === "create") {
      const res = await fetch(`/api/portal/${token}/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not add lead");
        return;
      }
      const j = (await res.json()) as { id: string };
      const newRow: PipelineEntry = {
        id: j.id,
        stage: "introduction",
        needs_replacement: body.needs_replacement,
        lead_name: body.lead_name,
        lead_email: body.lead_email,
        lead_phone: body.lead_phone,
        current_brokerage: body.current_brokerage,
        agent_profile_url: body.agent_profile_url,
        lead_location: null,
        introduced_at: body.introduced_at,
        lead_detail: null,
        campaign_name: null,
        notes_log: [],
      };
      onApply(j.id, {}, newRow);
      toast.success("Candidate added");
      onClose();
      return;
    }

    const res = await fetch(`/api/portal/${token}/pipeline/${target.entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not save");
      return;
    }
    onApply(target.entry.id, body);
    toast.success("Lead updated");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target.mode === "create" ? "Add a candidate" : "Edit lead"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-[12px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <Label className="text-[12px]">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
          <div>
            <Label className="text-[12px]">Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(123) 456-7890" />
          </div>
          <div>
            <Label className="text-[12px]">Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Compass" />
          </div>
          <div>
            <Label className="text-[12px]">Website</Label>
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[12px]">Introduction date</Label>
            <Input
              type="date"
              value={introducedAt}
              onChange={(e) => setIntroducedAt(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 rounded-md border border-[#ebecf0] bg-[#fafbfc] px-3 py-2 text-[12.5px] text-[#5b6472] sm:col-span-2">
            <input
              type="checkbox"
              checked={needsReplacement}
              onChange={(e) => setNeedsReplacement(e.target.checked)}
              className="size-3.5 accent-[#1565C0]"
            />
            <span>
              <span className="font-medium text-[#0f1320]">Mark as needing replacement.</span>{" "}
              Always shows the Replacement tag next to the lead's name. (Leads
              in stage "No Show" show the tag automatically.)
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => startTransition(submit)}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : target.mode === "create" ? (
              "Add candidate"
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "YYYY-MM-DD" suitable for <input type=date>. We anchor to UTC so the
// stored ISO survives round-trips without a timezone shift on the user.
function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function csvCell(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function normalizeUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}
function trimUrl(u: string): string {
  return u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}
