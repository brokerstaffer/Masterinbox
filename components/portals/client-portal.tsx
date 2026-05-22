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
const SOURCE_COLORS: Record<string, string> = {
  instantly: "#1565C0",
  emailbison: "#7c5cff",
  other: "#94a3b8",
};

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

        {/* Weekly volume + Source */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Panel title="Weekly volume" subtitle={`Last ${metrics.weekly.length} weeks`}>
            <WeeklyBars weekly={metrics.weekly} />
          </Panel>
          <Panel title="By source" subtitle="Where introductions originate">
            <SourceDonut metrics={metrics} />
          </Panel>
        </div>

        {/* Monthly + Weekday */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Monthly performance" subtitle="Trailing 6 months">
            <MonthlyBars monthly={metrics.monthly} />
          </Panel>
          <Panel title="Day of week" subtitle="When introductions land">
            <WeekdayBars metrics={metrics} />
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

function GrowthChart({ points }: { points: { label: string; total: number }[] }) {
  if (points.length === 0) return <ChartEmpty />;
  const W = 100;
  const H = 46;
  const PAD_T = 5;
  const PAD_B = 6;
  const max = Math.max(1, ...points.map((p) => p.total));
  const n = points.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.total)}`).join(" ");
  const area = `${line} L ${x(n - 1)} ${H} L ${x(0)} ${H} Z`;
  const last = points[n - 1];

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
        <defs>
          <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1="0"
            x2={W}
            y1={y(max * g)}
            y2={y(max * g)}
            stroke="#eef0f3"
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="url(#growthFill)" />
        <path
          d={line}
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(n - 1)} cy={y(last.total)} r="4.5" fill={ACCENT} opacity="0.16" />
        <circle cx={x(n - 1)} cy={y(last.total)} r="2.2" fill={ACCENT} />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-[#9aa0ab]">
        <span>{points[0].label}</span>
        <span className="font-semibold text-[#1565C0]">
          {last.total.toLocaleString()} total · week of {last.label}
        </span>
      </div>
    </div>
  );
}

function WeeklyBars({
  weekly,
}: {
  weekly: { weekStart: string; label: string; count: number }[];
}) {
  const max = Math.max(1, ...weekly.map((b) => b.count));
  return (
    <div className="mt-5 flex h-32 items-end gap-1.5">
      {weekly.map((b) => {
        const pct = (b.count / max) * 100;
        return (
          <div key={b.weekStart} className="group flex flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full flex-1 items-end">
              <div
                className="w-full rounded-md bg-gradient-to-t from-[#1565C0] to-[#4a93e8] transition-all duration-200 group-hover:from-[#1e88e5] group-hover:to-[#6aa9ef]"
                style={{ height: `${Math.max(pct, b.count > 0 ? 6 : 2)}%` }}
              />
              {b.count > 0 ? (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums text-[#1565C0] opacity-0 transition-opacity group-hover:opacity-100">
                  {b.count}
                </span>
              ) : null}
            </div>
            <span className="whitespace-nowrap text-[9px] text-[#9aa0ab]">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function MonthlyBars({ monthly }: { monthly: { key: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...monthly.map((m) => m.count));
  const total = monthly.reduce((s, m) => s + m.count, 0);
  if (total === 0) return <ChartEmpty />;
  return (
    <div className="mt-5 flex h-32 items-end gap-3">
      {monthly.map((m, i) => {
        const pct = (m.count / max) * 100;
        const isLast = i === monthly.length - 1;
        return (
          <div key={m.key} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full flex-1 items-end">
              {m.count > 0 ? (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums text-[#0f1320]">
                  {m.count}
                </span>
              ) : null}
              <div
                className={cn(
                  "w-full rounded-md transition-all",
                  isLast ? "bg-gradient-to-t from-[#1565C0] to-[#4a93e8]" : "bg-[#cdddf2]",
                )}
                style={{ height: `${Math.max(pct, m.count > 0 ? 7 : 3)}%` }}
              />
            </div>
            <span className="text-[10px] text-[#9aa0ab]">{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SourceDonut({ metrics }: { metrics: PortalMetrics }) {
  const slices = metrics.bySource;
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) return <ChartEmpty />;

  const C = 2 * Math.PI * 15.5;
  let offset = 0;

  return (
    <div className="mt-4 flex items-center gap-5">
      <div className="relative shrink-0">
        <svg viewBox="0 0 40 40" className="size-[112px] -rotate-90">
          <circle cx="20" cy="20" r="15.5" fill="none" stroke="#f0f1f4" strokeWidth="5" />
          {slices.map((s) => {
            const len = (s.count / total) * C;
            const seg = (
              <circle
                key={s.key}
                cx="20"
                cy="20"
                r="15.5"
                fill="none"
                stroke={SOURCE_COLORS[s.key] ?? SOURCE_COLORS.other}
                strokeWidth="5"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold leading-none tabular-nums">{total}</span>
          <span className="text-[9px] uppercase tracking-wide text-[#9aa0ab]">total</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-[13px]">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: SOURCE_COLORS[s.key] ?? SOURCE_COLORS.other }}
            />
            <span className="truncate font-medium">{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-[#9aa0ab]">
              {s.count} · {Math.round((s.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignBars({ metrics }: { metrics: PortalMetrics }) {
  const rows = metrics.topCampaigns;
  if (rows.length === 0) return <ChartEmpty />;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="mt-4 space-y-3">
      {rows.map((r) => (
        <div key={r.name}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[12.5px] text-[#0f1320]">{r.name}</span>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#1565C0]">
              {r.count}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#f0f2f5]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#1565C0] to-[#4a93e8]"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function WeekdayBars({ metrics }: { metrics: PortalMetrics }) {
  const days = metrics.byWeekday;
  const max = Math.max(1, ...days.map((d) => d.count));
  const totalAll = days.reduce((s, d) => s + d.count, 0);
  if (totalAll === 0) return <ChartEmpty />;
  return (
    <div className="mt-5 flex h-28 items-end gap-2">
      {days.map((d) => {
        const pct = (d.count / max) * 100;
        const peak = d.count === max && max > 0;
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full flex-1 items-end">
              <div
                className={cn(
                  "w-full rounded-md transition-all",
                  peak ? "bg-gradient-to-t from-[#1565C0] to-[#4a93e8]" : "bg-[#cdddf2]",
                )}
                style={{ height: `${Math.max(pct, d.count > 0 ? 8 : 3)}%` }}
              />
            </div>
            <span className="text-[10px] text-[#9aa0ab]">{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="mt-4 flex h-28 items-center justify-center rounded-xl border border-dashed border-[#e4e6ea] text-xs text-[#9aa0ab]">
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
          {lead.source_provider ? (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[#9aa0ab]">
              {lead.source_provider === "instantly" ? "Instantly" : "EmailBison"}
            </div>
          ) : null}
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
                    <dd className="min-w-0 break-words text-[#0f1320]">{String(v)}</dd>
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
        <div className="break-words text-[13px] text-[#0f1320]">{value}</div>
      </div>
    </div>
  );
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
