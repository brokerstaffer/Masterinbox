"use client";

import { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Copy,
  Mail as MailIcon,
  Link2,
} from "lucide-react";
import { LabelChip } from "@/components/inbox/label-chip";
import { SubsequencePicker } from "@/components/inbox/subsequence-picker";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ThreadDetail } from "@/lib/inbox/thread-detail";

type TabId = "details" | "attachments" | "notes";

// Map common social-link keys (case-insensitive) in lead.custom_fields to icons.
const SOCIAL_KEYS: Array<{ match: RegExp; label: string }> = [
  { match: /linkedin/i, label: "LinkedIn" },
  { match: /twitter|x[\W_]*url|x[\W_]*handle/i, label: "Twitter / X" },
  { match: /facebook|fb[\W_]*url/i, label: "Facebook" },
  { match: /instagram/i, label: "Instagram" },
  { match: /(website|home[\W_]*page|company[\W_]*site|url)/i, label: "Website" },
];

// Keys we surface in the About section before falling through to Custom.
const ABOUT_KEY_MAP: Record<string, string> = {
  title: "Title",
  job_title: "Title",
  role: "Title",
  position: "Title",
  company: "Company",
  company_name: "Company",
  organization: "Company",
  industry: "Industry",
  location: "Location",
  city: "Location",
  country: "Country",
  phone: "Phone",
  phone_number: "Phone",
};

export function ProspectPanel({ detail }: { detail: ThreadDetail }) {
  const { lead, labels } = detail;
  const [tab, setTab] = useState<TabId>("details");

  const initials = (lead.full_name || lead.email || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const emailDomain = lead.email?.split("@")[1] ?? null;

  // Split custom_fields into three buckets: socials, about-promotions, custom.
  const { socials, aboutExtras, customExtras } = partitionCustomFields(lead.custom_fields);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <aside className="w-[320px] shrink-0 border-l bg-background overflow-y-auto">
      <div className="h-10 border-b flex items-center px-4">
        <span className="text-sm font-medium">Prospect details</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md bg-zinc-100 text-zinc-700 flex items-center justify-center text-sm font-semibold shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate flex items-center gap-1.5">
              {lead.full_name ?? lead.email ?? "Unknown"}
              {lead.email ? (
                <button
                  type="button"
                  onClick={() => copy(lead.email!)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Copy name"
                >
                  <Copy className="size-3" />
                </button>
              ) : null}
            </div>
            {lead.email ? (
              <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                <span className="truncate">{lead.email}</span>
                <button
                  type="button"
                  onClick={() => copy(lead.email!)}
                  className="hover:text-foreground"
                  aria-label="Copy email"
                >
                  <Copy className="size-3" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {labels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <LabelChip key={l.id} name={l.name} color={l.color} />
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-4 border-b">
          {(["details", "attachments", "notes"] as TabId[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "text-sm pb-2 capitalize transition-colors",
                tab === t
                  ? "text-foreground font-medium border-b-2 border-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "details" ? (
          <DetailsTab
            threadId={detail.id}
            lead={lead}
            emailDomain={emailDomain}
            socials={socials}
            aboutExtras={aboutExtras}
            customExtras={customExtras}
            sourceProvider={detail.source_provider}
            campaignName={detail.campaign_name}
            clientName={detail.client_name}
          />
        ) : null}
        {tab === "attachments" ? (
          <div className="text-sm text-muted-foreground py-2">No attachments yet.</div>
        ) : null}
        {tab === "notes" ? (
          <div className="text-sm text-muted-foreground py-2">No notes yet.</div>
        ) : null}
      </div>
    </aside>
  );
}

interface SocialEntry {
  label: string;
  url: string;
}

interface AboutExtra {
  label: string;
  value: string;
}

function partitionCustomFields(cf: Record<string, unknown>): {
  socials: SocialEntry[];
  aboutExtras: AboutExtra[];
  customExtras: AboutExtra[];
} {
  const socials: SocialEntry[] = [];
  const aboutExtras: AboutExtra[] = [];
  const customExtras: AboutExtra[] = [];

  for (const [rawKey, rawValue] of Object.entries(cf ?? {})) {
    if (rawValue == null || rawValue === "") continue;
    const value = String(rawValue);
    const normalized = rawKey.toLowerCase().replace(/[\s\-]+/g, "_");

    const social = SOCIAL_KEYS.find((s) => s.match.test(rawKey));
    if (social && /^https?:\/\//i.test(value)) {
      socials.push({ label: social.label, url: value });
      continue;
    }

    if (ABOUT_KEY_MAP[normalized]) {
      aboutExtras.push({ label: ABOUT_KEY_MAP[normalized], value });
      continue;
    }

    customExtras.push({ label: prettifyKey(rawKey), value });
  }

  return { socials, aboutExtras, customExtras };
}

function prettifyKey(key: string): string {
  return key
    .replace(/[_\-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function DetailsTab({
  threadId,
  lead,
  emailDomain,
  socials,
  aboutExtras,
  customExtras,
  sourceProvider,
  campaignName,
  clientName,
}: {
  threadId: string;
  lead: ThreadDetail["lead"];
  emailDomain: string | null;
  socials: SocialEntry[];
  aboutExtras: AboutExtra[];
  customExtras: AboutExtra[];
  sourceProvider: ThreadDetail["source_provider"];
  campaignName: string | null;
  clientName: string | null;
}) {
  return (
    <div className="space-y-4">

      {(sourceProvider || campaignName || clientName) ? (
        <Section title="Campaign" defaultOpen>
          <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
            {sourceProvider ? (
              <FieldPair
                label="Source"
                value={sourceProvider === "instantly" ? "Instantly" : "EmailBison"}
              />
            ) : null}
            {clientName ? <FieldPair label="Client" value={clientName} /> : null}
            {campaignName ? <FieldPair label="Campaign" value={campaignName} /> : null}
          </dl>
          {/* Subsequence picker — only Instantly supports per-campaign
              subsequences via the public API (verified live; EmailBison's
              public API has no equivalent endpoint). */}
          {sourceProvider === "instantly" && campaignName ? (
            <div className="mt-3">
              <SubsequencePicker threadId={threadId} />
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="About" defaultOpen>
        <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
          {lead.email ? (
            <>
              <dt className="text-xs text-muted-foreground inline-flex items-center gap-1.5 pt-0.5">
                <MailIcon className="size-3.5" />
              </dt>
              <dd className="truncate">{lead.email}</dd>
            </>
          ) : null}
          {emailDomain ? (
            <>
              <dt className="text-xs text-muted-foreground inline-flex items-center gap-1.5 pt-0.5">
                <Link2 className="size-3.5" />
              </dt>
              <dd className="truncate">{emailDomain}</dd>
            </>
          ) : null}
          {lead.title ? (
            <>
              <dt className="text-xs text-muted-foreground">Title</dt>
              <dd className="truncate">{lead.title}</dd>
            </>
          ) : null}
          {lead.company ? (
            <>
              <dt className="text-xs text-muted-foreground">Company</dt>
              <dd className="truncate">{lead.company}</dd>
            </>
          ) : null}
          {aboutExtras.map((e) => (
            <FieldPair key={`${e.label}-${e.value}`} label={e.label} value={e.value} />
          ))}
        </dl>
      </Section>

      {(lead.linkedin_url || socials.length > 0) && (
        <Section title="Socials" defaultOpen>
          <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
            {lead.linkedin_url ? (
              <FieldPair label="LinkedIn" value={lead.linkedin_url} link />
            ) : null}
            {socials.map((s) => (
              <FieldPair key={s.url} label={s.label} value={s.url} link />
            ))}
          </dl>
        </Section>
      )}

      {customExtras.length > 0 && (
        <Section title="Custom" defaultOpen>
          <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
            {customExtras.map((e) => (
              <FieldPair key={`${e.label}-${e.value}`} label={e.label} value={e.value} />
            ))}
          </dl>
        </Section>
      )}
    </div>
  );
}

function FieldPair({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: boolean;
}) {
  return (
    <>
      <dt className="text-xs text-muted-foreground truncate">{label}</dt>
      <dd className="truncate">
        {link ? (
          <a
            href={value}
            target="_blank"
            rel="noopener"
            className="text-blue-600 hover:underline"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-sm font-medium flex items-center gap-1.5 hover:text-foreground/80 mb-2"
      >
        {title}
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  );
}
