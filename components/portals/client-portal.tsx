"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  CalendarDays,
  Trophy,
  Gauge,
  Search,
  Mail,
  Building2,
  Megaphone,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PortalLogo } from "@/components/portals/portal-logo";
import { PortalRefresher } from "@/components/portals/portal-refresher";
import type { IntroLead } from "@/lib/portals/intro-leads";
import type { PortalMetrics } from "@/lib/portals/metrics";

interface Props {
  clientName: string;
  leads: IntroLead[]; // newest-first
  metrics: PortalMetrics;
  // Rendered inside the internal admin drill-down rather than the public
  // portal — shows a preview banner, suppresses the live poll.
  adminPreview?: boolean;
}

const ACCENT = "#1565C0";

export function ClientPortalView({ clientName, leads, metrics, adminPreview }: Props) {
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#0f1320] antialiased">
      {!adminPreview ? <PortalRefresher /> : null}

      {/* ===================== TOP BAR ===================== */}
      <div className="sticky top-0 z-20 border-b border-[#ebecf0] bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-6">
          <PortalLogo className="size-7" />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">{clientName}</div>
            <div className="text-[11px] text-[#9aa0ab]">Introductions Portal</div>
          </div>
          <div className="ml-auto">
            <LiveBadge adminPreview={adminPreview} />
          </div>
        </div>
      </div>

      {/* ===================== HERO ===================== */}
      <header className="relative overflow-hidden border-b border-[#ebecf0] bg-white">
        {/* soft brand glow, very faint */}
        <div
          className="pointer-events-none absolute -right-20 -top-28 size-[420px] rounded-full opacity-[0.55] blur-3xl"
          style={{ background: "radial-gradient(circle, #dcebfd 0%, transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-5xl px-6 py-12">
          {adminPreview ? (
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-[#d4e4f8] bg-[#eaf2fd] px-2.5 py-1 text-[11px] font-medium text-[#1565C0]">
              <Activity className="size-3" /> Admin preview — exactly what the client sees
            </div>
          ) : null}

          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9aa0ab]">
            Total introductions
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-5">
            <div className="text-[84px] font-semibold leading-[0.95] tracking-[-0.045em] tabular-nums">
              {metrics.total.toLocaleString()}
            </div>
            <div className="mb-2 flex gap-2.5">
              <HeroStat label="This week" value={metrics.thisWeek} delta={metrics.weekDelta} />
              <HeroStat label="This month" value={metrics.thisMonth} delta={metrics.monthDelta} />
            </div>
          </div>
          <p className="mt-5 max-w-xl text-[13.5px] leading-relaxed text-[#5b6472]">
            {heroSentence(metrics)}
          </p>
        </div>
      </header>

      {/* ===================== BODY ===================== */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* KPI tiles */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile
            icon={Activity}
            label="This week"
            value={metrics.thisWeek}
            sub={deltaText(metrics.weekDelta, "vs last week")}
            tone={tone(metrics.weekDelta)}
          />
          <MetricTile
            icon={CalendarDays}
            label="This month"
            value={metrics.thisMonth}
            sub={deltaText(metrics.monthDelta, "vs last month")}
            tone={tone(metrics.monthDelta)}
          />
          <MetricTile
            icon={Trophy}
            label="Best week"
            value={metrics.bestWeek.count}
            sub={`Week of ${metrics.bestWeek.label}`}
          />
          <MetricTile
            icon={Gauge}
            label="Weekly average"
            value={metrics.weeklyAverage}
            sub={`Across ${metrics.activeWeeks} active week${metrics.activeWeeks === 1 ? "" : "s"}`}
          />
        </section>

        {/* Growth */}
        <Panel
          className="mt-4"
          title="Cumulative growth"
          subtitle="Running total of introductions delivered"
        >
          <GrowthChart points={metrics.cumulative} />
        </Panel>

        {/* Weekly volume — full width for the 12-bar series */}
        <Panel
          className="mt-4"
          title="Weekly volume"
          subtitle={`Introductions over the last ${metrics.weekly.length} weeks`}
        >
          <BarChart data={metrics.weekly.map((w) => ({ label: w.label, value: w.count }))} />
        </Panel>

        {/* Monthly + Weekday */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Monthly performance" subtitle="Trailing 6 months">
            <BarChart
              data={metrics.monthly.map((m) => ({ label: m.label, value: m.count }))}
              highlightLast
            />
          </Panel>
          <Panel title="Day of week" subtitle="When introductions land">
            <BarChart data={metrics.byWeekday.map((d) => ({ label: d.day, value: d.count }))} />
          </Panel>
        </div>

        {/* Campaigns */}
        <Panel className="mt-4" title="Top campaigns" subtitle="Introductions by campaign">
          <CampaignBars metrics={metrics} />
        </Panel>

        {/* Leads */}
        <LeadsSection leads={leads} />

        <footer className="mt-12 flex items-center justify-center gap-1.5 pb-4 text-xs text-[#9aa0ab]">
          <PortalLogo className="size-4" />
          Powered by Corofy
        </footer>
      </main>
    </div>
  );
}

/* ============================ hero pieces ============================ */

function LiveBadge({ adminPreview }: { adminPreview?: boolean }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#ebecf0] bg-white px-2.5 py-1 text-[11px] font-medium text-[#5b6472] shadow-sm">
      <span className="relative flex size-1.5">
        {!adminPreview ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        ) : null}
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      {adminPreview ? "Preview" : "Live"}
    </div>
  );
}

function HeroStat({ label, value, delta }: { label: string; value: number; delta: number }) {
  return (
    <div className="rounded-xl border border-[#ebecf0] bg-[#f6f7f9] px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9aa0ab]">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <DeltaTag delta={delta} />
      </div>
    </div>
  );
}

function DeltaTag({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#9aa0ab]">
        <Minus className="size-3" />
        even
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-semibold",
        up ? "text-[#0c8a4e]" : "text-[#c23934]",
      )}
    >
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "+" : ""}
      {delta}
    </span>
  );
}

/* ============================ tiles + panels ============================ */

function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  sub: string;
  tone?: "up" | "down" | "flat";
}) {
  const subColor =
    tone === "up"
      ? "text-[#0c8a4e]"
      : tone === "down"
        ? "text-[#c23934]"
        : "text-[#9aa0ab]";
  return (
    <div className="group rounded-2xl border border-[#ebecf0] bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          {label}
        </span>
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#f6f7f9] text-[#aab0ba] transition-colors group-hover:bg-[#eaf2fd] group-hover:text-[#1565C0]">
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="mt-2.5 text-[32px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className={cn("mt-1.5 text-[11.5px]", subColor)}>{sub}</div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[#ebecf0] bg-white p-5 shadow-sm",
        className,
      )}
    >
      <div className="text-[13.5px] font-semibold tracking-tight">{title}</div>
      {subtitle ? <div className="mt-0.5 text-xs text-[#9aa0ab]">{subtitle}</div> : null}
      {children}
    </section>
  );
}

/* ============================ charts ============================ */

// Tiny hook — flips true on the first frame after mount so charts can
// animate in (bars grow, the line draws). One pass, no loop.
function useMounted(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

// Catmull-Rom → cubic Bézier, so the cumulative line is a smooth curve
// rather than jagged segments.
function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const t = 0.16; // smoothing tension
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// Cumulative growth — smooth gradient area + glowing line that draws in
// on mount. Fixed-aspect viewBox so the endpoint node stays a true
// circle (the old preserveAspectRatio="none" stretched it into a blob).
function GrowthChart({ points }: { points: { label: string; total: number }[] }) {
  const mounted = useMounted();
  if (points.length === 0) return <ChartEmpty />;

  const W = 600;
  const H = 200;
  const padT = 22;
  const padB = 24;
  const padL = 8;
  const padR = 12;
  const max = Math.max(1, ...points.map((p) => p.total));
  const n = points.length;
  const x = (i: number) =>
    padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const coords = points.map((p, i) => ({ x: x(i), y: y(p.total) }));
  const line = smoothLine(coords);
  const area = `${line} L ${coords[n - 1].x} ${H - padB} L ${coords[0].x} ${H - padB} Z`;
  const last = points[n - 1];
  const lp = coords[n - 1];

  return (
    <div className="mt-5">
      <div className="aspect-[3/1] w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="growthArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
              <stop offset="55%" stopColor={ACCENT} stopOpacity="0.06" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="growthLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#5fa0ee" />
              <stop offset="100%" stopColor="#1257b0" />
            </linearGradient>
            <filter id="growthGlow" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>

          {/* gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line
              key={g}
              x1={padL}
              x2={W - padR}
              y1={y(max * g)}
              y2={y(max * g)}
              stroke="#eef0f3"
              strokeWidth="1"
            />
          ))}

          {/* area */}
          <path
            d={area}
            fill="url(#growthArea)"
            style={{ opacity: mounted ? 1 : 0, transition: "opacity 0.9s ease-out" }}
          />

          {/* glow + line, drawn in via dashoffset (pathLength normalises to 1) */}
          <path
            d={line}
            fill="none"
            stroke={ACCENT}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.16"
            filter="url(#growthGlow)"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={mounted ? 0 : 1}
            style={{ transition: "stroke-dashoffset 1.1s ease-out" }}
          />
          <path
            d={line}
            fill="none"
            stroke="url(#growthLine)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={mounted ? 0 : 1}
            style={{ transition: "stroke-dashoffset 1.1s ease-out" }}
          />

          {/* endpoint node */}
          <g
            style={{
              opacity: mounted ? 1 : 0,
              transition: "opacity 0.4s ease-out 0.9s",
            }}
          >
            <circle cx={lp.x} cy={lp.y} r="13" fill={ACCENT} opacity="0.1" />
            <circle cx={lp.x} cy={lp.y} r="6.5" fill={ACCENT} opacity="0.22" />
            <circle cx={lp.x} cy={lp.y} r="4.5" fill={ACCENT} />
            <circle cx={lp.x} cy={lp.y} r="1.8" fill="#fff" />
          </g>
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-[11px]">
        <span className="text-[#9aa0ab]">{points[0].label}</span>
        <span className="font-semibold text-[#1565C0]">
          {last.total.toLocaleString()} total · week of {last.label}
        </span>
      </div>
    </div>
  );
}

// One bar chart for weekly / monthly / weekday. Every bar sits in a faint
// full-height track so the chart reads as a deliberate grid even when the
// data is sparse — the old version just showed empty space. Bars grow in
// on mount; the peak bar is emphasised.
function BarChart({
  data,
  highlightLast,
}: {
  data: { label: string; value: number }[];
  // monthly → emphasise the current (last) month rather than the max bar.
  highlightLast?: boolean;
}) {
  const mounted = useMounted();
  const max = Math.max(1, ...data.map((d) => d.value));
  const hasData = data.some((d) => d.value > 0);
  if (!hasData) return <ChartEmpty />;

  return (
    <div className="mt-5 flex items-end gap-1.5 sm:gap-2">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        const isPeak = highlightLast
          ? i === data.length - 1
          : d.value === max && d.value > 0;
        return (
          <div key={`${d.label}-${i}`} className="group flex flex-1 flex-col items-center">
            {/* track */}
            <div className="relative flex h-32 w-full items-end overflow-hidden rounded-full bg-[#f1f3f6]">
              {d.value > 0 ? (
                <div
                  className={cn(
                    "w-full rounded-full transition-[height] duration-700 ease-out",
                    isPeak
                      ? "bg-gradient-to-t from-[#0d4f9e] to-[#3b8ae5] shadow-[0_2px_12px_rgba(21,101,192,0.4)]"
                      : "bg-gradient-to-t from-[#6ba6e6] to-[#a8caf2] group-hover:from-[#1565C0] group-hover:to-[#5fa0ee]",
                  )}
                  style={{ height: mounted ? `${Math.max(pct, 14)}%` : "0%" }}
                />
              ) : null}
            </div>
            {/* value + label */}
            <div className="mt-2 flex flex-col items-center leading-tight">
              <span
                className={cn(
                  "text-[12px] font-semibold tabular-nums",
                  d.value > 0 ? "text-[#0f1320]" : "text-[#cfd3da]",
                )}
              >
                {d.value}
              </span>
              <span className="mt-0.5 whitespace-nowrap text-[10px] text-[#9aa0ab]">
                {d.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Top campaigns — horizontal bars in faint tracks, widths grow in.
function CampaignBars({ metrics }: { metrics: PortalMetrics }) {
  const mounted = useMounted();
  const rows = metrics.topCampaigns;
  if (rows.length === 0) return <ChartEmpty />;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="mt-4 space-y-3.5">
      {rows.map((r) => (
        <div key={r.name}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-medium text-[#0f1320]">{r.name}</span>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#1565C0]">
              {r.count}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[#f1f3f6]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0d4f9e] to-[#5fa0ee] transition-[width] duration-700 ease-out"
              style={{ width: mounted ? `${Math.max((r.count / max) * 100, 4)}%` : "0%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="mt-4 flex h-32 items-center justify-center rounded-xl border border-dashed border-[#e4e6ea] text-xs text-[#9aa0ab]">
      Not enough data yet
    </div>
  );
}

/* ============================ leads ============================ */

function LeadsSection({ leads }: { leads: IntroLead[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.lead_name, l.lead_email, l.company, l.title, l.campaign_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [leads, query]);

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-0.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Introduction leads</h2>
          <span className="text-xs text-[#9aa0ab]">
            {query.trim() ? `${filtered.length} of ${leads.length}` : `${leads.length} total`}
          </span>
        </div>
        {leads.length > 0 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9aa0ab]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads…"
              className="h-8 w-52 rounded-lg border border-[#ebecf0] bg-white pl-8 pr-2.5 text-[12.5px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd]"
            />
          </div>
        ) : null}
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dde0e5] bg-white p-14 text-center">
          <PortalLogo className="mx-auto size-10 opacity-60" />
          <p className="mt-3 text-sm font-medium">No introductions yet</p>
          <p className="mt-1 text-xs text-[#9aa0ab]">
            New introductions appear here automatically as they happen.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#ebecf0] bg-white p-12 text-center text-sm text-[#9aa0ab]">
          No leads match “{query.trim()}”.
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((lead) => (
            <LeadCard key={lead.thread_id} lead={lead} />
          ))}
        </div>
      )}
    </section>
  );
}

function LeadCard({ lead }: { lead: IntroLead }) {
  const [open, setOpen] = useState(false);
  const name = lead.lead_name || lead.lead_email || "Unknown lead";
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const customEntries = Object.entries(lead.custom_fields ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-sm transition-all",
        open ? "border-[#d4e4f8]" : "border-[#ebecf0] hover:border-[#dde0e5]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#fafbfc]"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eaf2fd] text-xs font-semibold text-[#1565C0]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{name}</div>
          <div className="truncate text-xs text-[#5b6472]">
            {[lead.title, lead.company].filter(Boolean).join(" · ") ||
              lead.lead_email ||
              "—"}
          </div>
        </div>
        {lead.campaign_name ? (
          <span className="hidden max-w-[180px] shrink-0 truncate rounded-md bg-[#f6f7f9] px-2 py-1 text-[11px] text-[#5b6472] sm:block">
            {lead.campaign_name}
          </span>
        ) : null}
        <div className="shrink-0 text-right">
          <div className="text-xs text-[#5b6472]">
            <RelAgo iso={lead.assigned_at} />
          </div>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[#9aa0ab] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-[#f0f1f4] bg-[#fafbfc] px-4 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DetailRow icon={Mail} label="Email" value={lead.lead_email} />
            <DetailRow icon={Building2} label="Company" value={lead.company} />
            <DetailRow icon={Activity} label="Title" value={lead.title} />
            <DetailRow icon={Megaphone} label="Campaign" value={lead.campaign_name} />
            <DetailRow icon={Mail} label="Subject" value={lead.subject} />
            <DetailRow icon={Calendar} label="Introduced" value={fmtDate(lead.assigned_at)} />
          </div>

          {customEntries.length > 0 ? (
            <>
              <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
                Campaign details
              </div>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2">
                {customEntries.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="shrink-0 text-[#9aa0ab]">{prettifyKey(k)}</dt>
                    <dd className="min-w-0 break-words text-[#0f1320]">
                      <LinkedValue value={String(v)} />
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[#ebecf0] bg-white px-3 py-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-[#aab0ba]" />
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          {label}
        </div>
        <div className="break-words text-[13px] text-[#0f1320]">
          <LinkedValue value={value} />
        </div>
      </div>
    </div>
  );
}

// Renders a field value — as a clickable link when it's a URL (lead
// detail carries long profile / website URLs), plain text otherwise.
function LinkedValue({ value }: { value: string }) {
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v)) {
    return (
      <a
        href={v}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-medium text-[#1565C0] hover:underline"
      >
        {v}
      </a>
    );
  }
  return <>{value}</>;
}

/* ============================ helpers ============================ */

// Hydration-safe relative time: server renders the fallback, the client
// fills the real value after mount (no Date.now() drift mismatch).
function RelAgo({ iso }: { iso: string | null }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!iso) {
      setText("—");
      return;
    }
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) {
      setText("—");
      return;
    }
    const secs = Math.floor((Date.now() - then) / 1000);
    if (secs < 60) setText("just now");
    else if (secs < 3600) setText(`${Math.floor(secs / 60)}m ago`);
    else if (secs < 86400) setText(`${Math.floor(secs / 3600)}h ago`);
    else if (secs < 604800) setText(`${Math.floor(secs / 86400)}d ago`);
    else if (secs < 2629800) setText(`${Math.floor(secs / 604800)}w ago`);
    else setText(`${Math.floor(secs / 2629800)}mo ago`);
  }, [iso]);
  return <>{text || "—"}</>;
}

function heroSentence(metrics: PortalMetrics): string {
  if (metrics.total === 0) {
    return "Your introductions will appear here in real time as they happen.";
  }
  const parts: string[] = [];
  if (metrics.firstIntroAt) parts.push(`Tracking since ${fmtDate(metrics.firstIntroAt)}`);
  parts.push(`${metrics.activeWeeks} active week${metrics.activeWeeks === 1 ? "" : "s"}`);
  parts.push(`${metrics.weeklyAverage} per week on average`);
  return `${parts.join(" · ")}.`;
}

function deltaText(delta: number, suffix: string): string {
  if (delta === 0) return `Even ${suffix}`;
  return `${delta > 0 ? "+" : ""}${delta} ${suffix}`;
}

function tone(delta: number): "up" | "down" | "flat" {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function prettifyKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
