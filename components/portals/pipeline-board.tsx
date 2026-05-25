"use client";

import { useMemo, useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Check,
  Search,
  StickyNote,
  Loader2,
  RefreshCw,
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [editingNotes, setEditingNotes] = useState<PipelineEntry | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (stageFilter.size > 0 && !stageFilter.has(e.stage)) return false;
      if (replaceOnly && !e.needs_replacement) return false;
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
  function toggleReplace(id: string, value: boolean) {
    setEntries((cur) =>
      cur.map((e) => (e.id === id ? { ...e, needs_replacement: value } : e)),
    );
    void patch(id, { needs_replacement: value });
  }
  async function saveNotes(id: string, notes: string) {
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, notes } : e)));
    await patch(id, { notes });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-12 pt-6">
      {entries.length === 0 ? (
        <PortalEmpty
          title="No introductions yet"
          hint="New candidates appear here automatically as introductions land in the inbox."
        />
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
                  className="h-9 w-64 rounded-lg border border-[#ebecf0] bg-white pl-8 pr-3 text-[13px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd]"
                />
              </div>
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-[#ebecf0] bg-white px-3 text-[13px] text-[#5b6472]">
                <input
                  type="checkbox"
                  checked={replaceOnly}
                  onChange={(e) => setReplaceOnly(e.target.checked)}
                  className="size-3.5 accent-[#1565C0]"
                />
                Needs replacement only
              </label>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#ebecf0] bg-white px-3 text-[13px] font-medium text-[#5b6472] transition-colors hover:bg-[#f6f7f9]"
                title="Refresh"
              >
                <RefreshCw className="size-3.5" />
                Refresh
              </button>
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

          {/* Table */}
          <div
            className={cn(
              "overflow-hidden rounded-2xl border border-[#ebecf0] bg-white shadow-sm transition-opacity duration-500",
              mounted ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="grid grid-cols-[1.6fr_1.2fr_120px_140px_180px_72px_80px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
              <div>Candidate</div>
              <div>Brokerage</div>
              <div>Phone</div>
              <div>Introduced</div>
              <div>Stage</div>
              <div className="text-center">Replace?</div>
              <div className="text-right">Notes</div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#9aa0ab]">
                No candidates match the current filters.
              </div>
            ) : (
              <div className="divide-y divide-[#f0f1f4]">
                {filtered.map((e) => (
                  <PipelineRow
                    key={e.id}
                    entry={e}
                    onStage={(s) => changeStage(e.id, s)}
                    onReplaceToggle={(v) => toggleReplace(e.id, v)}
                    onOpenNotes={() => setEditingNotes(e)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {editingNotes ? (
        <NotesDialog
          entry={editingNotes}
          onClose={() => setEditingNotes(null)}
          onSave={async (notes) => {
            await saveNotes(editingNotes.id, notes);
            setEditingNotes(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PipelineRow({
  entry,
  onStage,
  onReplaceToggle,
  onOpenNotes,
}: {
  entry: PipelineEntry;
  onStage: (s: PipelineStage) => void;
  onReplaceToggle: (v: boolean) => void;
  onOpenNotes: () => void;
}) {
  return (
    <div className="grid grid-cols-[1.6fr_1.2fr_120px_140px_180px_72px_80px] items-start gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={entry.lead_name ?? entry.lead_email ?? "?"} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium">
            {entry.lead_name || entry.lead_email || "Unknown"}
          </div>
          {entry.lead_email ? (
            <div className="truncate text-[11.5px] text-[#9aa0ab]">{entry.lead_email}</div>
          ) : null}
          {entry.notes ? (
            <button
              type="button"
              onClick={onOpenNotes}
              className="mt-1 line-clamp-2 max-w-[36ch] cursor-pointer text-left text-[11.5px] italic leading-snug text-[#5b6472] hover:text-[#0f1320]"
              title={entry.notes}
            >
              {entry.notes}
            </button>
          ) : null}
        </div>
      </div>
      <div className="truncate text-[13px] text-[#5b6472]">{entry.current_brokerage ?? "—"}</div>
      <div className="text-[12.5px] tabular-nums text-[#5b6472]">{entry.lead_phone ?? "—"}</div>
      <div className="text-[12.5px] text-[#5b6472]">{fmtDate(entry.introduced_at)}</div>
      <div>
        <StageSelector value={entry.stage} onChange={onStage} />
      </div>
      <div className="flex justify-center">
        <input
          type="checkbox"
          checked={entry.needs_replacement}
          onChange={(e) => onReplaceToggle(e.target.checked)}
          className="size-4 accent-[#1565C0]"
          aria-label="Needs replacement"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onOpenNotes}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors",
            entry.notes
              ? "border-[#d4e4f8] bg-[#eaf2fd] text-[#1565C0] hover:bg-[#dbe9fa]"
              : "border-[#ebecf0] bg-white text-[#9aa0ab] hover:bg-[#f6f7f9]",
          )}
          title={entry.notes ?? "Add notes"}
        >
          <StickyNote className="size-3.5" />
          {entry.notes ? "Edit" : "Add"}
        </button>
      </div>
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
              "inline-flex w-full items-center justify-between gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all hover:brightness-95",
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

function NotesDialog({
  entry,
  onClose,
  onSave,
}: {
  entry: PipelineEntry;
  onClose: () => void;
  onSave: (notes: string) => Promise<void>;
}) {
  const [text, setText] = useState(entry.notes ?? "");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Notes — {entry.lead_name ?? entry.lead_email ?? "Candidate"}
          </DialogTitle>
        </DialogHeader>
        <Textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pre-call notes, post-call notes, follow-up reminders…"
          rows={10}
          className="resize-y text-[13px]"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => startTransition(async () => await onSave(text))}
            disabled={pending}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Save notes"}
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
