"use client";

import type { PipelineEntry } from "@/lib/portals/portal-data";

// Inline expandable detail block for a Recruiting Pipeline row.
// Renders every meaningful field on the lead, including the enriched
// Instantly payload — uniformly in a grid that wraps on narrow screens
// for mobile readers.

type LeadDetail = {
  company?: string | null;
  title?: string | null;
  custom_fields?: Record<string, unknown>;
};

interface DetailField {
  label: string;
  value: string;
}

export function PipelineDetailInline({
  entry,
}: {
  entry: PipelineEntry;
  // Reserved for future inline-edit interactions. The caller currently
  // passes a no-op patch handler; keeping it on the type lets us avoid
  // a future breaking-change to consumers.
  token?: string;
  onLocalUpdate?: (patch: Partial<PipelineEntry>) => void;
}) {
  const detail = (entry.lead_detail ?? {}) as LeadDetail;
  const cf = (detail.custom_fields ?? {}) as Record<string, unknown>;

  const fields: DetailField[] = [];
  const shown = new Set<string>();

  const tryPush = (label: string, value: unknown, dedupKey?: string) => {
    if (!hasValue(value)) return;
    fields.push({ label, value: String(value).trim() });
    if (dedupKey) shown.add(dedupKey.toLowerCase());
  };

  tryPush("Email", entry.lead_email, "email");

  const phone = cf.phone ?? entry.lead_phone;
  tryPush("Phone", phone, "phone");

  const company = entry.current_brokerage ?? detail.company;
  tryPush("Company", company, "company");

  tryPush("Title", detail.title, "title");

  tryPush("Website", entry.agent_profile_url, "website");

  tryPush("Location", entry.lead_location, "location");

  for (const [k, v] of Object.entries(cf)) {
    if (shown.has(k.toLowerCase())) continue;
    if (!hasValue(v)) continue;
    fields.push({ label: prettyKey(k), value: String(v).trim() });
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
    <div className="px-4 py-5 sm:px-12 sm:py-6">
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {fields.map((f) => (
            <FieldStack key={f.label} label={f.label} value={f.value} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#ebecf0] bg-white px-4 py-3 text-[12px] text-[#9aa0ab]">
          No additional details captured for this lead yet.
        </div>
      )}

      {introducedDate || entry.campaign_name ? (
        <div className="mt-7 grid grid-cols-1 gap-x-12 gap-y-3 border-t border-[#ebecf0] pt-6 md:grid-cols-[220px_1fr]">
          {introducedDate ? <FieldStack label="Introduced" value={introducedDate} /> : null}
          {entry.campaign_name ? <FieldStack label="Campaign" value={entry.campaign_name} /> : null}
        </div>
      ) : null}

      {entry.notes_log.length > 0 ? (
        <div className="mt-7 border-t border-[#ebecf0] pt-6">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#aab0ba]">
            Notes
          </div>
          <ul className="mt-2 space-y-2">
            {entry.notes_log.map((n) => (
              <li key={n.id} className="rounded-lg bg-white p-2.5 ring-1 ring-[#ebecf0]">
                <div className="text-[11px] text-[#9aa0ab]">
                  {new Date(n.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#0f1320]">
                  {n.body}
                </p>
              </li>
            ))}
          </ul>
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

function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

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
  if (l === "phone" || l === "mobile" || l === "cell" || l.includes("phone")) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      return {
        href: `tel:${value.replace(/[^+\d]/g, "")}`,
        display: value,
      };
    }
  }
  if (l === "website" || l === "linkedin" || l === "profile" || l.includes("url")) {
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
