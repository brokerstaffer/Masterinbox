"use client";

import type { PipelineEntry } from "@/lib/portals/portal-data";

// Inline expandable detail block for a Recruiting Pipeline row.
// Stacked label-above-value layout — same pattern Linear, Notion and
// Stripe use for property panels: small muted-uppercase labels, regular
// values, generous vertical rhythm. All data comes from
// external_intros.lead_detail joined onto the pipeline row.

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

  const contactFields: Array<FieldData> = [
    entry.lead_email && {
      label: "Email",
      value: entry.lead_email,
      href: `mailto:${entry.lead_email}`,
    },
    phone && {
      label: "Phone",
      value: phone,
      href: `tel:${phone.replace(/[^+\d]/g, "")}`,
    },
    website && {
      label: "Website",
      value: trimUrl(website),
      href: website,
      external: true,
    },
    linkedIn && {
      label: "LinkedIn",
      value: trimUrl(linkedIn),
      href: linkedIn,
      external: true,
    },
    agentProfile && {
      label: "Profile",
      value: trimUrl(agentProfile),
      href: agentProfile,
      external: true,
    },
  ].filter(Boolean) as FieldData[];

  const companyFields: Array<FieldData> = [
    entry.current_brokerage && {
      label: "Company",
      value: entry.current_brokerage,
    },
    detail.title && { label: "Title", value: String(detail.title) },
    brand && { label: "Brand", value: brand },
    license && { label: "License #", value: license },
    tenure && { label: "Tenure", value: tenure },
  ].filter(Boolean) as FieldData[];

  const locationFields: Array<FieldData> = [
    location && { label: "Market", value: location },
    city && city !== location && { label: "City", value: city },
    state && { label: "State", value: state },
    county && { label: "County", value: county },
    agencyZip && { label: "Office ZIP", value: agencyZip },
  ].filter(Boolean) as FieldData[];

  const introducedDate = entry.introduced_at
    ? new Date(entry.introduced_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="px-12 py-6">
      {/* Top row — three stacked-field columns */}
      <div className="grid grid-cols-1 gap-x-12 gap-y-7 md:grid-cols-3">
        <FieldColumn fields={contactFields} />
        <FieldColumn fields={companyFields} />
        <FieldColumn fields={locationFields} />
      </div>

      {/* Pipeline / Campaign — separator above, two columns */}
      {(introducedDate || entry.campaign_name) ? (
        <div className="mt-7 grid grid-cols-1 gap-x-12 gap-y-3 border-t border-[#ebecf0] pt-6 md:grid-cols-[200px_1fr]">
          {introducedDate ? (
            <FieldStack label="Introduced" value={introducedDate} />
          ) : null}
          {entry.campaign_name ? (
            <FieldStack label="Campaign" value={entry.campaign_name} />
          ) : null}
        </div>
      ) : null}

      {/* Performance — full-width compact grid */}
      {performance.length > 0 ? (
        <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-[#ebecf0] pt-6 md:grid-cols-4">
          {performance.map(([k, v]) => (
            <FieldStack key={k} label={k} value={v} />
          ))}
        </div>
      ) : null}

      {/* Catch-all */}
      {other.length > 0 ? (
        <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-[#ebecf0] pt-6 md:grid-cols-4">
          {other.map(([k, v]) => (
            <FieldStack key={k} label={k} value={v} />
          ))}
        </div>
      ) : null}

      {entry.notes ? (
        <div className="mt-7 border-t border-[#ebecf0] pt-6">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
            Notes
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#0f1320]">
            {entry.notes}
          </p>
        </div>
      ) : null}

      {!entry.lead_detail && contactFields.length === 0 && companyFields.length === 0 && locationFields.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#ebecf0] bg-white px-4 py-3 text-[12px] text-[#9aa0ab]">
          No Instantly enrichment captured for this lead yet.
        </div>
      ) : null}
    </div>
  );
}

interface FieldData {
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}

function FieldColumn({ fields }: { title?: string; fields: FieldData[] }) {
  if (fields.length === 0) {
    return <div className="text-[12.5px] text-[#aab0ba]">—</div>;
  }
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <FieldStack key={f.label} {...f} />
      ))}
    </div>
  );
}

function FieldStack({
  label,
  value,
  href,
  external,
}: FieldData) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] leading-snug text-[#0f1320]">
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
          <span className="block break-words" title={value}>
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

// Strip the protocol + trailing slash so links read as cleaner labels:
// "https://www.homes.com/real-estate-agents/foo/" → "homes.com/real-estate-agents/foo"
function trimUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}
