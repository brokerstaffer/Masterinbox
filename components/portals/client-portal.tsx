"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Activity,
  CalendarDays,
  Trophy,
  Gauge,
  Sparkles,
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

const SOURCE_COLORS: Record<string, string> = {
  instantly: "#1565C0",
  emailbison: "#7c3aed",
  other: "#94a3b8",
};

export function ClientPortalView({ clientName, leads, metrics, adminPreview }: Props) {
  return (
    <div className="min-h-screen bg-[#eef2f7]">
      {!adminPreview ? <PortalRefresher /> : null}

      {/* ===================== HERO ===================== */}
      <header className="relative overflow-hidden bg-[#0a1f3c]">
        {/* glow accents */}
        <div
          className="absolute -top-24 -right-16 size-80 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #2f7fe0 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-32 -left-10 size-80 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #1565C0 0%, transparent 70%)" }}
        />
        {/* faint grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        <div className="relative max-w-4xl mx-auto px-6 pt-9 pb-24">
          {adminPreview ? (
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-white/10 ring-1 ring-white/15 px-3 py-1 text-xs font-medium text-white/90">
              <Sparkles className="size-3" /> Admin preview — exactly what the client sees
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white p-1.5 shadow-lg shadow-black/20">
              <PortalLogo className="size-8" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-[#7fa8d8]">{clientName}</div>
              <h1 className="text-xl font-semibold tracking-tight text-white leading-tight">
                Introductions Portal
              </h1>
            </div>
            <div className="ml-auto">
              <LiveBadge adminPreview={adminPreview} />
            </div>
          </div>

          {/* Hero number */}
          <div className="mt-9 flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#7fa8d8] font-semibold">
                Total introductions
              </div>
              <div className="mt-1 text-7xl font-semibold tracking-tighter text-white tabular-nums leading-none">
                {metrics.total}
              </div>
            </div>
            <HeroPill
              label="This week"
              value={String(metrics.thisWeek)}
              delta={metrics.weekDelta}
            />
            <HeroPill
              label="This month"
              value={String(metrics.thisMonth)}
              delta={metrics.monthDelta}
            />
          </div>
        </div>
      </header>

      {/* ===================== BODY ===================== */}
      {/* relative z-10: the hero <header> is position:relative, so without
          its own stacking the static <main> would paint UNDER it and the
          cards that float up via -mt-16 would be hidden. */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 -mt-16 pb-16">
        {/* Metric tiles */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricTile
            icon={Activity}
            label="This week"
            value={String(metrics.thisWeek)}
            sub={deltaText(metrics.weekDelta, "vs last week")}
            deltaTone={tone(metrics.weekDelta)}
          />
          <MetricTile
            icon={CalendarDays}
            label="This month"
            value={String(metrics.thisMonth)}
            sub={deltaText(metrics.monthDelta, "vs last month")}
            deltaTone={tone(metrics.monthDelta)}
          />
          <MetricTile
            icon={Trophy}
            label="Best week"
            value={String(metrics.bestWeek.count)}
            sub={metrics.bestWeek.label}
          />
          <MetricTile
            icon={Gauge}
            label="Weekly average"
            value={metrics.weeklyAverage.toString()}
            sub={`${metrics.activeWeeks} active weeks`}
          />
        </section>

        {/* Growth curve — full width */}
        <Panel title="Cumulative growth" subtitle="Running total of introductions">
          <GrowthChart points={metrics.cumulative} />
        </Panel>

        {/* Weekly trend + Source split */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 mt-4">
          <Panel title="Weekly volume" subtitle={`Last ${metrics.weekly.length} weeks`}>
            <WeeklyBars weekly={metrics.weekly} />
          </Panel>
          <Panel title="By source" subtitle="Where intros came from">
            <SourceDonut metrics={metrics} />
          </Panel>
        </div>

        {/* Top campaigns + weekday */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <Panel title="Top campaigns" subtitle="Introductions by campaign">
            <CampaignBars metrics={metrics} />
          </Panel>
          <Panel title="Day of week" subtitle="When intros land">
            <WeekdayBars metrics={metrics} />
          </Panel>
        </div>

        {/* Leads */}
        <section className="mt-8">
          <div className="flex items-baseline justify-between mb-3 px-1">
            <h2 className="text-[15px] font-semibold text-[#15181e]">
              Introduction leads
            </h2>
            <span className="text-xs text-[#5b6370]">{leads.length} total</span>
          </div>

          {leads.length === 0 ? (
            <div className="rounded-2xl bg-white border border-dashed border-[#d6dde6] p-14 text-center">
              <PortalLogo className="size-10 mx-auto opacity-60" />
              <p className="mt-3 text-sm font-medium text-[#15181e]">
                No introductions yet
              </p>
              <p className="mt-1 text-xs text-[#5b6370]">
                New introductions appear here automatically as they happen.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {leads.map((lead) => (
                <LeadCard key={lead.thread_id} lead={lead} />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 flex items-center justify-center gap-1.5 text-xs text-[#9aa1ac]">
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
    <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 ring-1 ring-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90">
      <span className="relative flex size-1.5">
        {!adminPreview ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        ) : null}
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
      </span>
      {adminPreview ? "Preview" : "Live"}
    </div>
  );
}

function HeroPill({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number;
}) {
  return (
    <div className="rounded-xl bg-white/[0.07] ring-1 ring-white/10 px-4 py-2.5 backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-wider text-[#7fa8d8] font-semibold">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white tabular-nums">{value}</span>
        <DeltaTag delta={delta} />
      </div>
    </div>
  );
}

function DeltaTag({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="text-[11px] text-[#7fa8d8]">even</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium",
        up ? "text-emerald-400" : "text-rose-400",
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
  deltaTone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  deltaTone?: "up" | "down" | "flat";
}) {
  const subColor =
    deltaTone === "up"
      ? "text-[#2f7d4f]"
      : deltaTone === "down"
        ? "text-[#b03030]"
        : "text-[#9aa1ac]";
  return (
    <div className="rounded-2xl bg-white border border-[#e3e8ef] shadow-sm p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-[#9aa1ac] font-semibold">
          {label}
        </span>
        <Icon className="size-4 text-[#c2cad6]" />
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-[#15181e]">
        {value}
      </div>
      <div className={cn("mt-0.5 text-[11px]", subColor)}>{sub}</div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white border border-[#e3e8ef] shadow-sm p-5 mt-4 first:mt-4">
      <div className="text-[13px] font-semibold text-[#15181e]">{title}</div>
      {subtitle ? (
        <div className="text-xs text-[#9aa1ac] mt-0.5">{subtitle}</div>
      ) : null}
      {children}
    </section>
  );
}

/* ============================ charts ============================ */

// Cumulative area + line chart — pure SVG, responsive via viewBox.
function GrowthChart({ points }: { points: { label: string; total: number }[] }) {
  if (points.length === 0) {
    return <ChartEmpty />;
  }
  const W = 100;
  const H = 44;
  const max = Math.max(1, ...points.map((p) => p.total));
  const n = points.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => 40 - (v / max) * 34;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.total)}`).join(" ");
  const area = `${line} L ${x(n - 1)} ${H} L ${x(0)} ${H} Z`;
  const last = points[n - 1];

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-36">
        <defs>
          <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1565C0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#1565C0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#growthFill)" />
        <path
          d={line}
          fill="none"
          stroke="#1565C0"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(n - 1)} cy={y(last.total)} r="2.4" fill="#1565C0" />
        <circle cx={x(n - 1)} cy={y(last.total)} r="4.5" fill="#1565C0" opacity="0.18" />
      </svg>
      <div className="flex justify-between mt-1.5 text-[10px] text-[#9aa1ac]">
        <span>{points[0].label}</span>
        <span className="font-medium text-[#1565C0]">
          {last.total} total · {last.label}
        </span>
      </div>
    </div>
  );
}

function WeeklyBars({ weekly }: { weekly: { weekStart: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...weekly.map((b) => b.count));
  return (
    <div className="mt-4 flex items-end gap-1.5 h-32">
      {weekly.map((b) => {
        const pct = (b.count / max) * 100;
        return (
          <div key={b.weekStart} className="flex-1 flex flex-col items-center gap-1.5 group">
            <div className="relative w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-[#1565C0] to-[#3b8ae5] transition-all group-hover:from-[#1e88e5] group-hover:to-[#5ba3ef]"
                style={{ height: `${Math.max(pct, b.count > 0 ? 6 : 2)}%` }}
              />
              {b.count > 0 ? (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-[#1565C0] tabular-nums">
                  {b.count}
                </span>
              ) : null}
            </div>
            <span className="text-[9px] text-[#9aa1ac] whitespace-nowrap">{b.label}</span>
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

  const C = 2 * Math.PI * 16; // r = 16
  let offset = 0;

  return (
    <div className="mt-3 flex items-center gap-5">
      <svg viewBox="0 0 40 40" className="size-28 -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" stroke="#eef0f3" strokeWidth="6" />
        {slices.map((s) => {
          const len = (s.count / total) * C;
          const seg = (
            <circle
              key={s.key}
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke={SOURCE_COLORS[s.key] ?? SOURCE_COLORS.other}
              strokeWidth="6"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div className="space-y-2">
        {slices.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-[13px]">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: SOURCE_COLORS[s.key] ?? SOURCE_COLORS.other }}
            />
            <span className="text-[#15181e] font-medium">{s.label}</span>
            <span className="text-[#9aa1ac] tabular-nums">
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
    <div className="mt-3.5 space-y-2.5">
      {rows.map((r) => (
        <div key={r.name}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[12.5px] text-[#15181e] truncate">{r.name}</span>
            <span className="text-[12px] font-semibold text-[#1565C0] tabular-nums shrink-0">
              {r.count}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[#eef2f7] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#1565C0] to-[#3b8ae5]"
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
    <div className="mt-4 flex items-end gap-2 h-28">
      {days.map((d) => {
        const pct = (d.count / max) * 100;
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="relative w-full flex-1 flex items-end">
              <div
                className={cn(
                  "w-full rounded-md transition-all",
                  d.count === max && max > 0
                    ? "bg-[#1565C0]"
                    : "bg-[#bcd5f1]",
                )}
                style={{ height: `${Math.max(pct, d.count > 0 ? 8 : 3)}%` }}
              />
            </div>
            <span className="text-[10px] text-[#9aa1ac]">{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="mt-3 h-28 flex items-center justify-center text-xs text-[#9aa1ac]">
      Not enough data yet
    </div>
  );
}

/* ============================ leads ============================ */

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
    <div className="rounded-xl bg-white border border-[#e3e8ef] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[#f4f7fb] transition-colors"
      >
        <div className="size-9 shrink-0 rounded-full bg-[#E3F0FF] text-[#1565C0] flex items-center justify-center text-xs font-semibold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[#15181e] truncate">{name}</div>
          <div className="text-xs text-[#5b6370] truncate">
            {[lead.title, lead.company].filter(Boolean).join(" · ") ||
              lead.campaign_name ||
              "—"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-[#5b6370]">
            <RelAgo iso={lead.assigned_at} />
          </div>
          {lead.source_provider ? (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[#9aa1ac]">
              {lead.source_provider === "instantly" ? "Instantly" : "EmailBison"}
            </div>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-[#9aa1ac] shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-[#eef0f3] px-4 py-3.5 bg-[#fafbfc]">
          <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <Field label="Email" value={lead.lead_email} />
            <Field label="Company" value={lead.company} />
            <Field label="Title" value={lead.title} />
            <Field label="Campaign" value={lead.campaign_name} />
            <Field label="Subject" value={lead.subject} />
            <Field label="Introduced" value={fmtDate(lead.assigned_at)} />
          </dl>

          {customEntries.length > 0 ? (
            <>
              <div className="mt-3.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa1ac]">
                Campaign details
              </div>
              <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                {customEntries.map(([k, v]) => (
                  <Field key={k} label={prettifyKey(k)} value={String(v)} />
                ))}
              </dl>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-[#9aa1ac]">{label}</dt>
      <dd className="text-[#15181e] break-words">{value}</dd>
    </>
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
