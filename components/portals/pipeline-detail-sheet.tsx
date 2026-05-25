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
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { PipelineEntry } from "@/lib/portals/portal-data";
import { Avatar } from "@/components/portals/portal-ui";

// Slide-out side-panel that shows everything Instantly knows about a
// lead. Triggered by clicking a row in the Recruiting Pipeline. All
// fields come from external_intros.lead_detail (the Instantly
// enrichment payload joined onto the pipeline row at load time).

// Custom-field keys to display in the dedicated "Performance" card.
// Anything not matched lands in the catch-all "Other details" list at
// the bottom, so brokerages never lose fields that Instantly added.
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

const TENURE_KEYS = new Set([
  "Years in Industry",
  "Industry Tenure",
  "Est. time in industry",
]);

const LICENSE_KEYS = new Set([
  "LicenseNumber",
  "License Number",
  "License number",
]);

// Keys already surfaced as first-class fields (we hide them from the
// catch-all so they don't show twice).
const SURFACED_KEYS = new Set([
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

export function PipelineDetailSheet({
  entry,
  onOpenChange,
}: {
  entry: PipelineEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = entry !== null;
  const detail = (entry?.lead_detail ?? {}) as {
    company?: string | null;
    title?: string | null;
    custom_fields?: Record<string, string | null | undefined>;
  };
  const cf = detail.custom_fields ?? {};

  const phone = cf.phone || entry?.lead_phone || null;
  const website = cf.website || entry?.agent_profile_url || null;
  const linkedIn = cf.linkedIn || null;
  const location = cf.location || null;
  const state = cf.State || null;
  const county = cf.County || null;
  const city = cf.City || null;
  const agencyZip = cf.AgencyZip || cf["Office Zip"] || cf["Office zip code"] || null;
  const brand = cf.Brand || null;
  const agentProfile = cf["Agent Profile"] || null;

  const license =
    pickFirst(cf, ["LicenseNumber", "License Number", "License number"]);
  const tenure =
    pickFirst(cf, ["Years in Industry", "Industry Tenure", "Est. time in industry"]);

  const performance: Array<[string, string]> = Object.entries(cf)
    .filter(([k, v]) => PERFORMANCE_KEYS.has(k) && hasValue(v))
    .map(([k, v]) => [prettyKey(k), String(v)]);

  const other: Array<[string, string]> = Object.entries(cf)
    .filter(([k, v]) => !SURFACED_KEYS.has(k) && hasValue(v))
    .map(([k, v]) => [prettyKey(k), String(v)]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md md:max-w-lg"
      >
        {entry ? (
          <>
            <SheetHeader className="border-b border-[#ebecf0] pb-4">
              <div className="flex items-start gap-3">
                <Avatar
                  name={entry.lead_name ?? entry.lead_email ?? "?"}
                  className="!size-12 text-sm"
                />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-[16px] font-semibold">
                    {entry.lead_name ?? entry.lead_email ?? "Unnamed candidate"}
                  </SheetTitle>
                  {detail.title || entry.current_brokerage ? (
                    <SheetDescription className="mt-0.5 text-[12.5px] text-[#5b6472]">
                      {[detail.title, entry.current_brokerage]
                        .filter(Boolean)
                        .join(" · ")}
                    </SheetDescription>
                  ) : (
                    <SheetDescription className="sr-only">
                      Full lead detail from Instantly enrichment
                    </SheetDescription>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-5 pt-5">
              <Section title="Contact">
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
                  <Field
                    icon={Link2}
                    label="LinkedIn"
                    value={linkedIn}
                    href={linkedIn}
                    external
                  />
                ) : null}
                {agentProfile ? (
                  <Field
                    icon={ExternalLink}
                    label="Agent profile"
                    value={agentProfile}
                    href={agentProfile}
                    external
                  />
                ) : null}
              </Section>

              {(entry.current_brokerage || brand || license || tenure) && (
                <Section title="Brokerage & role">
                  {entry.current_brokerage ? (
                    <Field
                      icon={Building2}
                      label="Company"
                      value={entry.current_brokerage}
                    />
                  ) : null}
                  {brand ? <Field label="Brand" value={brand} /> : null}
                  {license ? <Field label="License #" value={license} /> : null}
                  {tenure ? <Field label="Tenure" value={tenure} /> : null}
                </Section>
              )}

              {(location || city || state || county || agencyZip) && (
                <Section title="Location">
                  {location ? (
                    <Field icon={MapPin} label="Market" value={location} />
                  ) : null}
                  {city && city !== location ? (
                    <Field label="City" value={city} />
                  ) : null}
                  {state ? <Field label="State" value={state} /> : null}
                  {county ? <Field label="County" value={county} /> : null}
                  {agencyZip ? <Field label="Office ZIP" value={agencyZip} /> : null}
                </Section>
              )}

              {performance.length > 0 ? (
                <Section title="Performance" icon={TrendingUp}>
                  {performance.map(([k, v]) => (
                    <Field key={k} label={k} value={v} />
                  ))}
                </Section>
              ) : null}

              <Section title="Pipeline">
                <Field
                  icon={Calendar}
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
                  <Field
                    icon={Megaphone}
                    label="Campaign"
                    value={entry.campaign_name}
                  />
                ) : null}
                {entry.notes ? (
                  <div className="mt-2 rounded-lg border border-[#ebecf0] bg-[#fafbfc] p-3 text-[12.5px] leading-relaxed text-[#5b6472]">
                    <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
                      Your notes
                    </div>
                    <p className="whitespace-pre-wrap">{entry.notes}</p>
                  </div>
                ) : null}
              </Section>

              {other.length > 0 ? (
                <Section title="Other details">
                  {other.map(([k, v]) => (
                    <Field key={k} label={k} value={v} />
                  ))}
                </Section>
              ) : null}

              {!entry.lead_detail ? (
                <div className="rounded-lg border border-dashed border-[#ebecf0] bg-[#fafbfc] p-4 text-center text-[12px] text-[#9aa0ab]">
                  No Instantly enrichment available for this lead.
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof TrendingUp;
  children: React.ReactNode;
}) {
  const items = arrayifyChildren(children);
  if (items.length === 0) return null;
  return (
    <section>
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
}: {
  icon?: typeof Mail;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="flex w-[110px] shrink-0 items-center gap-1.5 text-[11.5px] text-[#9aa0ab]">
        {Icon ? <Icon className="size-3 shrink-0" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("min-w-0 flex-1 text-[12.5px]", href ? "" : "text-[#0f1320]")}>
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

// "Last12Mos_ListSoldDollars_Closed" → "Last 12 mos list sold dollars closed"
function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// React.Children.toArray-style filter so empty Sections collapse.
function arrayifyChildren(node: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const walk = (n: React.ReactNode) => {
    if (n === null || n === undefined || n === false) return;
    if (Array.isArray(n)) n.forEach(walk);
    else out.push(n);
  };
  walk(node);
  return out;
}
