import { TrendingUp, Activity, Trophy, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineSummary } from "@/lib/portals/pipeline-metrics";

// Stat strip rendered above the Recruiting Pipeline table. Server-side
// only; takes the precomputed summary so the page stays free of any
// hydration drift.

const TILES: Array<{
  icon: typeof TrendingUp;
  label: string;
  field: keyof PipelineSummary;
  hint: (s: PipelineSummary) => string;
  accent?: boolean;
}> = [
  {
    icon: TrendingUp,
    label: "Total introductions",
    field: "total",
    hint: (s) =>
      s.lastIntroAt
        ? `Most recent ${formatAbsolute(s.lastIntroAt)}`
        : "Waiting on the first intro",
    accent: true,
  },
  {
    icon: Activity,
    label: "This week",
    field: "thisWeek",
    hint: () => "Mon → today",
  },
  {
    icon: Workflow,
    label: "In active pipeline",
    field: "inActiveStages",
    hint: (s) =>
      s.total > 0
        ? `${Math.round((s.inActiveStages / s.total) * 100)}% of all intros`
        : "—",
  },
  {
    icon: Trophy,
    label: "Hired",
    field: "hired",
    hint: (s) =>
      s.hired > 0
        ? `${Math.round((s.hired / Math.max(s.total, 1)) * 100)}% conversion`
        : "Zero so far",
  },
];

export function PipelineHeader({
  clientName,
  summary,
}: {
  clientName: string;
  summary: PipelineSummary;
}) {
  return (
    <header className="mx-auto max-w-6xl px-6 pt-8">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9aa0ab]">
        {clientName} · Recruiting Pipeline
      </div>
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-[#0f1320]">
        Every introduction, end to end
      </h1>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-[#5b6472]">
        Every warm intro lands here. Move candidates through the stages, flag
        replacements, and keep your notes alongside the lead so nothing slips
        between conversations.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((t) => {
          const Icon = t.icon;
          const value = summary[t.field] as number;
          return (
            <div
              key={t.label}
              className={cn(
                "rounded-2xl border bg-white p-4 shadow-sm",
                t.accent ? "border-[#d4e4f8]" : "border-[#ebecf0]",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
                  {t.label}
                </span>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-lg",
                    t.accent
                      ? "bg-[#eaf2fd] text-[#1565C0]"
                      : "bg-[#f6f7f9] text-[#aab0ba]",
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
              </div>
              <div
                className={cn(
                  "mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums",
                  t.accent ? "text-[#1565C0]" : "text-[#0f1320]",
                )}
              >
                {value.toLocaleString()}
              </div>
              <div className="mt-1.5 text-[11.5px] text-[#9aa0ab]">
                {t.hint(summary)}
              </div>
            </div>
          );
        })}
      </div>
    </header>
  );
}

// Server-side only formatter (the whole PipelineHeader is server-rendered),
// so a fixed locale + UTC produces deterministic output and the page stays
// hydration-safe — no relative "X days ago" drift between SSR and the
// browser. Client asked for an absolute date instead of relative.
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
