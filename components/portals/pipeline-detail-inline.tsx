"use client";

import {
  Mail,
  Phone,
  Globe,
  Link2,
  MapPin,
  Building2,
  Calendar,
  Megaphone,
  TrendingUp,
  ExternalLink,
  IdCard,
  Clock,
} from "lucide-react";
import type { PipelineEntry } from "@/lib/portals/portal-data";

// Inline expandable detail block for a Recruiting Pipeline row.
// Rendered directly underneath the row (NOT in a side-panel) so the
// data shows in-context within the table. Sectioned into Contact /
// Company / Location / Performance / Pipeline + a catch-all so every
// field Instantly captured stays visible.

const PERFORMANCE_KEYS = new Set([
  "Closed Transactions",
  "Closed transactions",
  "Sales volume",
  "Avg. sales price",
  "Approx. GCI",
  "List-side ($)",
  "Buy-side ($)",
  "Total sales",
  "Sales last 12 months",
  "Last12Mos_ListSoldNum_Closed",
  "Last12Mos_ListSoldDollars_Closed",
  "Closed rentals",
  "Most transacted city",
]);

const TENURE_KEYS = ["Years in Industry", "Industry Tenure", "Est. time in industry"];
const LICENSE_KEYS = ["LicenseNumber", "License Number", "License number"];

const SURFACED_KEYS = new Set<string>([
  "phone",
  "website",
  "location",
  "linkedIn",
  "State",
  "County",
  "City",
  "AgencyZip",
  "Office Zip",
  "Office zip code",
  "Brand",
  "Agent Profile",
  ...PERFORMANCE_KEYS,
  ...TENURE_KEYS,
  ...LICENSE_KEYS,
]);

export function PipelineDetailInline({ entry }: { entry: PipelineEntry }) {
  const detail = (entry.lead_detail ?? {}) as {
    company?: string | null;
    title?: string | null;
    custom_fields?: Record<string, string | null | undefined>;
  };
  const cf = detail.custom_fields ?? {};

  const phone = cf.phone || entry.lead_phone || null;
  const website = cf.website || entry.agent_profile_url || null;
  const linkedIn = cf.linkedIn || null;
  const location = cf.location || null;
  const state = cf.State || null;
  const county = cf.County || null;
  const city = cf.City || null;
  const agencyZip = cf.AgencyZip || cf["Office Zip"] || cf["Office zip code"] || null;
  const brand = cf.Brand || null;
  const agentProfile = cf["Agent Profile"] || null;
  const license = pickFirst(cf, LICENSE_KEYS);
  const tenure = pickFirst(cf, TENURE_KEYS);

  const performance: Array<[string, string]> = Object.entries(cf)
    .filter(([k, v]) => PERFORMANCE_KEYS.has(k) && hasValue(v))
    .map(([k, v]) => [prettyKey(k), String(v)]);

  const other: Array<[string, string]> = Object.entries(cf)
    .filter(([k, v]) => !SURFACED_KEYS.has(k) && hasValue(v))
    .map(([k, v]) => [prettyKey(k), String(v)]);

  const hasContact = entry.lead_email || phone || website || linkedIn || agentProfile;
  const hasCompany = entry.current_brokerage || brand || license || tenure || detail.title;
  const hasLocation = location || city || state || county || agencyZip;

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-12 py-5 md:grid-cols-3">
      {hasContact ? (
        <Section title="Contact" icon={Mail}>
          {entry.lead_email ? (
            <Field
              icon={Mail}
              label="Email"
              value={entry.lead_email}
              href={`mailto:${entry.lead_email}`}
            />
          ) : null}
          {phone ? (
            <Field
              icon={Phone}
              label="Phone"
              value={phone}
              href={`tel:${phone.replace(/[^+\d]/g, "")}`}
            />
          ) : null}
          {website ? (
            <Field icon={Globe} label="Website" value={website} href={website} external />
          ) : null}
          {linkedIn ? (
            <Field icon={Link2} label="LinkedIn" value={linkedIn} href={linkedIn} external />
          ) : null}
          {agentProfile ? (
            <Field
              icon={ExternalLink}
              label="Profile"
              value={agentProfile}
              href={agentProfile}
              external
            />
          ) : null}
        </Section>
      ) : null}

      {hasCompany ? (
        <Section title="Company" icon={Building2}>
          {entry.current_brokerage ? (
            <Field label="Company" value={entry.current_brokerage} />
          ) : null}
          {detail.title ? <Field label="Title" value={detail.title} /> : null}
          {brand ? <Field label="Brand" value={brand} /> : null}
          {license ? <Field icon={IdCard} label="License #" value={license} /> : null}
          {tenure ? <Field icon={Clock} label="Tenure" value={tenure} /> : null}
        </Section>
      ) : null}

      {hasLocation ? (
        <Section title="Location" icon={MapPin}>
          {location ? <Field label="Market" value={location} /> : null}
          {city && city !== location ? <Field label="City" value={city} /> : null}
          {state ? <Field label="State" value={state} /> : null}
          {county ? <Field label="County" value={county} /> : null}
          {agencyZip ? <Field label="Office ZIP" value={agencyZip} /> : null}
        </Section>
      ) : null}

      {performance.length > 0 ? (
        <Section title="Performance" icon={TrendingUp} span={3}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-4">
            {performance.map(([k, v]) => (
              <Field key={k} label={k} value={v} compact />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Pipeline" icon={Calendar} span={hasContact || hasCompany || hasLocation ? 3 : 1}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-3">
          <Field
            label="Introduced"
            value={
              entry.introduced_at
                ? new Date(entry.introduced_at).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"
            }
          />
          {entry.campaign_name ? (
            <Field icon={Megaphone} label="Campaign" value={entry.campaign_name} />
          ) : null}
        </div>
      </Section>

      {other.length > 0 ? (
        <Section title="Other details" span={3}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-4">
            {other.map(([k, v]) => (
              <Field key={k} label={k} value={v} compact />
            ))}
          </div>
        </Section>
      ) : null}

      {!entry.lead_detail ? (
        <div className="md:col-span-3 rounded-md border border-dashed border-[#ebecf0] bg-white px-4 py-3 text-[12px] text-[#9aa0ab]">
          No Instantly enrichment captured for this lead yet.
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  span = 1,
  children,
}: {
  title: string;
  icon?: typeof Mail;
  span?: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  const colClass =
    span === 3 ? "md:col-span-3" : span === 2 ? "md:col-span-2" : "md:col-span-1";
  return (
    <section className={colClass}>
      <div className="mb-2 flex items-center gap-1.5">
        {Icon ? <Icon className="size-3 text-[#9aa0ab]" /> : null}
        <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          {title}
        </h3>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  href,
  external,
  compact,
}: {
  icon?: typeof Mail;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "min-w-0"
          : "flex items-baseline gap-3"
      }
    >
      <div
        className={
          compact
            ? "text-[10.5px] font-medium uppercase tracking-wide text-[#9aa0ab]"
            : "flex w-[88px] shrink-0 items-center gap-1.5 text-[11.5px] text-[#9aa0ab]"
        }
      >
        {!compact && Icon ? <Icon className="size-3 shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={
          compact
            ? "mt-0.5 text-[12.5px] font-medium tabular-nums text-[#0f1320]"
            : "min-w-0 flex-1 text-[12.5px]"
        }
      >
        {href ? (
          <a
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="block truncate text-[#1565C0] hover:underline"
            title={value}
          >
            {value}
          </a>
        ) : (
          <span className={compact ? "block truncate" : "block break-words text-[#0f1320]"} title={value}>
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

function pickFirst(
  obj: Record<string, string | null | undefined>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (hasValue(v)) return String(v);
  }
  return null;
}

function hasValue(v: unknown): v is string {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim().length === 0) return false;
  return true;
}

function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
