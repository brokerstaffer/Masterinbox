"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import type { PipelineEntry, PipelineStage } from "@/lib/portals/portal-data";
import { cn } from "@/lib/utils";

// Kanban renderer for the Recruiting Pipeline. Same entries the table
// already shows, grouped into one column per visible stage. Card click
// fires onCardClick which the parent wires to the existing
// EditLeadDialog — so every stage change still flows through one
// source of truth (the dialog's Stage dropdown), no parallel state
// machine and no drag-and-drop wiring yet.
//
// Visibility rules mirror the table:
//   • columns come from visibleStages (per-client gated; real clients
//     drop in-flight stages, OpsLabs sees the full set)
//   • labels come from stageLabels (the SSR-sanitised map — hidden
//     stages already mask their human label as the enum key)
//   • STAGE_STYLE is duplicated here on purpose so the Kanban column
//     dot stays single-source-of-truth with the table chip colour.
//     If those diverge later we should pull both from a shared
//     constant.

const COLUMN_STYLE: Record<PipelineStage, { dot: string; chip: string }> = {
  introduction:           { dot: "bg-[#1976d2]", chip: "bg-[#1976d2]" },
  phone_screen_scheduled: { dot: "bg-[#7689e0]", chip: "bg-[#7689e0]" },
  phone_screen:           { dot: "bg-[#4f63d2]", chip: "bg-[#4f63d2]" },
  interview_scheduled:    { dot: "bg-[#a98ff8]", chip: "bg-[#a98ff8]" },
  interview:              { dot: "bg-[#7c4dff]", chip: "bg-[#7c4dff]" },
  hired:                  { dot: "bg-[#10a05d]", chip: "bg-[#10a05d]" },
  keep_warm:              { dot: "bg-[#f5a623]", chip: "bg-[#f5a623]" },
  we_they_rejected:       { dot: "bg-[#e23a3a]", chip: "bg-[#e23a3a]" },
  no_show:                { dot: "bg-[#8b95a3]", chip: "bg-[#8b95a3]" },
};

interface Props {
  entries: PipelineEntry[];
  visibleStages: PipelineStage[];
  stageLabels: Record<PipelineStage, string>;
  onCardClick: (entry: PipelineEntry) => void;
  // Drag-and-drop stage change. Drop a card on a column → parent
  // updates the entry's stage (same flow as the dropdown menu
  // in the table view). No-op default so the prop stays optional.
  onStageChange?: (entryId: string, nextStage: PipelineStage) => void;
  // When true, the Source row is included in the card footer.
  // Driven by clients.feature_flags.pipeline_source_split — real
  // clients without the flag never get this as true so the source
  // value never enters the rendered HTML.
  showSource?: boolean;
}

export function PipelineKanban({
  entries,
  visibleStages,
  stageLabels,
  onCardClick,
  onStageChange,
  showSource = false,
}: Props) {
  // Track the currently-dragging entry id + the column the cursor is
  // hovering over so we can highlight the drop target. dragOverStage
  // gets cleared on dragleave + drop.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);
  const grouped = new Map<PipelineStage, PipelineEntry[]>();
  for (const s of visibleStages) grouped.set(s, []);
  for (const e of entries) {
    const arr = grouped.get(e.stage);
    if (arr) arr.push(e);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {visibleStages.map((stage) => {
        const col = grouped.get(stage) ?? [];
        const style = COLUMN_STYLE[stage];
        const isDropTarget = dragOverStage === stage;
        return (
          <div
            key={stage}
            // Drop-target plumbing. preventDefault on dragOver is
            // required by the HTML5 DnD spec — without it, drop()
            // never fires. We highlight the column on dragEnter and
            // clear the highlight on dragLeave / drop.
            onDragOver={(event) => {
              if (!onStageChange || !draggingId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDragEnter={() => {
              if (!onStageChange || !draggingId) return;
              setDragOverStage(stage);
            }}
            onDragLeave={(event) => {
              // Only clear when the cursor leaves the column entirely,
              // not when it enters a child element (relatedTarget will
              // still be inside the column in the latter case).
              const cur = event.currentTarget;
              const next = event.relatedTarget as Node | null;
              if (next && cur.contains(next)) return;
              if (dragOverStage === stage) setDragOverStage(null);
            }}
            onDrop={(event) => {
              if (!onStageChange) return;
              event.preventDefault();
              const id =
                event.dataTransfer.getData("application/x-pipeline-entry-id") ||
                draggingId;
              setDragOverStage(null);
              setDraggingId(null);
              if (!id) return;
              // No-op when the card is dropped on its current column.
              const cur = entries.find((e) => e.id === id);
              if (cur && cur.stage === stage) return;
              onStageChange(id, stage);
            }}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-xl border bg-[#fafbfc] transition-colors",
              isDropTarget
                ? "border-[#1565C0] ring-2 ring-[#eaf2fd]"
                : "border-[#ebecf0]",
            )}
          >
            <div className="flex items-center gap-2 border-b border-[#ebecf0] px-3 py-2.5">
              <span className={cn("size-2 rounded-full", style.dot)} />
              <span className="text-[12.5px] font-semibold text-[#0f1320]">
                {stageLabels[stage]}
              </span>
              <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#5b6472] ring-1 ring-[#ebecf0]">
                {col.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {col.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#ebecf0] px-3 py-6 text-center text-[11.5px] text-[#9aa0ab]">
                  No candidates
                </div>
              ) : (
                col.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    draggable={Boolean(onStageChange)}
                    onDragStart={(event) => {
                      if (!onStageChange) return;
                      setDraggingId(e.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        "application/x-pipeline-entry-id",
                        e.id,
                      );
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverStage(null);
                    }}
                    onClick={() => onCardClick(e)}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-lg border border-[#ebecf0] bg-white p-2.5 text-left shadow-sm transition-colors hover:border-[#bcd5f1] hover:bg-[#fcfdff]",
                      onStageChange ? "cursor-grab active:cursor-grabbing" : "",
                      draggingId === e.id ? "opacity-50" : "",
                    )}
                  >
                    <div className="truncate text-[13px] font-semibold text-[#0f1320]">
                      {e.lead_name ?? "(no name)"}
                    </div>
                    {e.current_brokerage ? (
                      <div className="truncate text-[11.5px] text-[#5b6472]">
                        {e.current_brokerage}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1.5 text-[11px] text-[#9aa0ab]">
                      <Calendar className="size-3" />
                      {e.introduced_at
                        ? new Date(e.introduced_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                      {showSource ? (
                        <span className="ml-auto truncate rounded-full bg-[#f6f7f9] px-1.5 py-0.5 text-[10px] font-medium text-[#5b6472]">
                          {e.source}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
