import { Phone, Reply, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  STAGE_ORDER,
  type PipelineStage,
} from "@/lib/portals/portal-data";

// Intro copy + best-practices + legend, rendered above the Recruiting
// Pipeline table. Server-side; the stat tiles live inside the board's
// client component so they update optimistically as stages move.

// Stage chip colour map mirrors the pipeline board so the legend reads
// as a direct lookup.
const LEGEND_STYLE: Record<PipelineStage, string> = {
  introduction: "bg-[#1976d2]",
  phone_screen: "bg-[#4f63d2]",
  interview: "bg-[#7c4dff]",
  hired: "bg-[#10a05d]",
  keep_warm: "bg-[#f5a623]",
  we_they_rejected: "bg-[#e23a3a]",
  no_show: "bg-[#8b95a3]",
};

// The same stage maps to two of the requested legend entries
// (Screening / Interview share copy); we surface them as one combined
// row so the client sees the definition without duplicates.
const LEGEND_ORDER: PipelineStage[] = STAGE_ORDER.filter(
  (s) => s !== "phone_screen",
);

const BEST_PRACTICES: Array<{ icon: typeof Reply; title: string; body: string }> = [
  {
    icon: Reply,
    title: "Reply to the intro email",
    body: "Acknowledge the introduction and confirm you’ll be calling them.",
  },
  {
    icon: MessageSquare,
    title: "Text the agent",
    body: "Confirm the call. Starting a text conversation has proven very effective.",
  },
  {
    icon: Phone,
    title: "Call the agent now",
    body: "Acknowledge the intro and lock in a specific time to talk further.",
  },
];

export function PipelineHeader({
  clientName,
}: {
  clientName: string;
}) {
  return (
    <header className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9aa0ab]">
        {clientName} · Recruiting Pipeline
      </div>
      <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-[#0f1320] sm:text-[26px]">
        Every introduction, end to end
      </h1>
      <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-[#5b6472]">
        Every warm intro lands here. Introductions will come by email from{" "}
        <span className="font-medium text-[#0f1320]">Nicole Collins</span>{" "}
        (<a
          href="mailto:nicole.c@brokerstaffer.com"
          className="text-[#1565C0] hover:underline"
        >
          nicole.c@brokerstaffer.com
        </a>
        ), the Talent Acquisition Coordinator assigned to your account, so
        please keep an eye out for emails from her.
      </p>

      {/* Best practices — what to do the moment an intro arrives. */}
      <section className="mt-6 rounded-2xl border border-[#d4e4f8] bg-[#f4f9ff] p-4 sm:p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#1565C0]">
          Best practices when an intro lands
        </div>
        <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {BEST_PRACTICES.map((b, i) => {
            const Icon = b.icon;
            return (
              <li
                key={b.title}
                className="flex items-start gap-3 rounded-xl border border-white/60 bg-white/80 p-3"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1565C0] text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0f1320]">
                    <Icon className="size-3.5 text-[#1565C0]" />
                    {b.title}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-[#5b6472]">
                    {b.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Legend — definitions for every stage, in the order they appear
          on the chips below. */}
      <section className="mt-6 rounded-2xl border border-[#ebecf0] bg-white p-4 sm:p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          What each stage means
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LEGEND_ORDER.map((s) => (
            <li key={s} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-1 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white",
                  LEGEND_STYLE[s],
                )}
              >
                {s === "interview" ? "Screening / Interview" : STAGE_LABELS[s]}
              </span>
              <p className="text-[12.5px] leading-snug text-[#5b6472]">
                {STAGE_DESCRIPTIONS[s]}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </header>
  );
}

