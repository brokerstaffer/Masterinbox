"use client";

import type { PipelineEntry } from "@/lib/portals/portal-data";

// Inline expandable detail block for a Recruiting Pipeline row.
// Renders EVERY field Instantly captured for the lead — no hardcoded
// categories. The lead's snapshot fields (email / phone / company /
// title) come first as universally useful contact info, then the full
// lead_detail.custom_fields payload follows in its natural order.
// Pipeline metadata (introduced date / campaign) and the brokerage's
// own notes sit beneath dividers.

type LeadDetail = {
  company?: string | null;
  title?: string | null;
  custom_fields?: Record<string, unknown>;
};

interface DetailField {
  label: string;
  value: string;
}

export function PipelineDetailInline({ entry }: { entry: PipelineEntry }) {
  const detail = (entry.lead_detail ?? {}) as LeadDetail;
  const cf = (detail.custom_fields ?? {}) as Record<string, unknown>;

  const fields: DetailField[] = [];
  // Track raw lower-cased keys already surfaced, to avoid showing the
  // same value twice when custom_fields and snapshot fields overlap.
  const shown = new Set<string>();

  const tryPush = (label: string, value: unknown, dedupKey?: string) => {
    if (!hasValue(value)) return;
    fields.push({ label, value: String(value).trim() });
    if (dedupKey) shown.add(dedupKey.toLowerCase());
  };

  // Universally useful contact + identity fields first.
  tryPush("Email", entry.lead_email, "email");

  const phone = cf.phone ?? entry.lead_phone;
  tryPush("Phone", phone, "phone");

  const company = detail.company ?? entry.current_brokerage;
  tryPush("Company", company, "company");

  tryPush("Title", detail.title, "title");

  // Everything else from custom_fields, in the order Instantly returned
  // it. This is the "any new field automatically shows up" part —
  // nothing is filtered out except keys we already surfaced above.
  for (const [k, v] of Object.entries(cf)) {
    if (shown.has(k.toLowerCase())) continue;
    if (!hasValue(v)) continue;
    fields.push({ label: prettyKey(k), value: String(v).trim() });
  }

  // Fallback: legacy pipeline rows without an external_intros backfill
  // still expose phone / agent profile via snapshot columns.
  if (fields.length === 0 && entry.agent_profile_url) {
    fields.push({ label: "Profile", value: entry.agent_profile_url });
  }

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
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {fields.map((f) => (
            <FieldStack key={f.label} label={f.label} value={f.value} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#ebecf0] bg-white px-4 py-3 text-[12px] text-[#9aa0ab]">
          No Instantly enrichment captured for this lead yet.
        </div>
      )}

      {introducedDate || entry.campaign_name ? (
        <div
          className={
            "mt-7 grid grid-cols-1 gap-x-12 gap-y-3 border-t border-[#ebecf0] pt-6 md:grid-cols-[220px_1fr]"
          }
        >
          {introducedDate ? <FieldStack label="Introduced" value={introducedDate} /> : null}
          {entry.campaign_name ? <FieldStack label="Campaign" value={entry.campaign_name} /> : null}
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
    </div>
  );
}

function FieldStack({ label, value }: DetailField) {
  const link = autoLink(label, value);
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] leading-snug">
        {link.href ? (
          <a
            href={link.href}
            target={link.external ? "_blank" : undefined}
            rel={link.external ? "noopener noreferrer" : undefined}
            className="block truncate text-[#1565C0] hover:underline"
            title={value}
          >
            {link.display}
          </a>
        ) : (
          <span className="block break-words text-[#0f1320]" title={value}>
            {link.display}
          </span>
        )}
      </div>
    </div>
  );
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (s === "" || s === "null" || s === "undefined" || s === "—") return false;
  return true;
}

// "Last12Mos_ListSoldDollars_Closed" → "Last 12 mos list sold dollars closed"
// "License Number" stays "License Number" (already pretty)
function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// Auto-detect URLs from the value (unambiguous: must start with
// http://); auto-detect emails + phones based on the field LABEL so
// that strings like a license number "(123) 456-789" don't get treated
// as a phone link.
function autoLink(
  label: string,
  value: string,
): { href?: string; external?: boolean; display: string } {
  if (/^https?:\/\//i.test(value)) {
    return { href: value, external: true, display: trimUrl(value) };
  }
  const l = label.toLowerCase();
  if (l === "email" || l.includes("email")) {
    if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(value)) {
      return { href: `mailto:${value}`, display: value };
    }
  }
  if (
    l === "phone" ||
    l === "mobile" ||
    l === "cell" ||
    l.includes("phone")
  ) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      return {
        href: `tel:${value.replace(/[^+\d]/g, "")}`,
        display: value,
      };
    }
  }
  if (
    l === "website" ||
    l === "linkedin" ||
    l === "profile" ||
    l.includes("url")
  ) {
    // Bare-domain fallback ("homes.com/...") still gets linkified.
    const hasDot = /\.[a-z]{2,}/i.test(value);
    if (hasDot && !value.includes(" ")) {
      const href = `https://${value.replace(/^\/+/, "")}`;
      return { href, external: true, display: trimUrl(value) };
    }
  }
  return { display: value };
}

function trimUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}
