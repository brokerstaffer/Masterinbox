"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Copy,
  Mail as MailIcon,
  Phone,
  MapPin,
  Building2,
  Globe,
  Megaphone,
  Users,
  Inbox,
} from "lucide-react";
import { LabelChip } from "@/components/inbox/label-chip";
import { SubsequenceSection } from "@/components/inbox/subsequence-status";
import { FollowupCampaignPicker } from "@/components/inbox/followup-campaign-picker";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ThreadDetail } from "@/lib/inbox/thread-detail";

type TabId = "details" | "attachments" | "notes";

// The panel is user-resizable; the width is persisted so it survives
// reloads and thread switches.
const WIDTH_KEY = "inbox-prospect-panel-width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 300;
const MAX_WIDTH = 580;

// normalise a custom-field key for case/punctuation-insensitive matching.
const nkey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function ProspectPanel({ detail }: { detail: ThreadDetail }) {
  const { lead, labels } = detail;
  const [tab, setTab] = useState<TabId>("details");

  // ---- resize ----
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WIDTH_KEY);
      if (!saved) return;
      const n = Number(saved);
      if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) setWidth(n);
    } catch {
      // private-mode Safari can throw — ignore.
    }
  }, []);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      // Handle is on the LEFT edge — dragging left widens the panel.
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, d.startWidth - (e.clientX - d.startX)),
      );
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
      dragRef.current = null;
      try {
        window.localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        // ignore
      }
    }
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
    e.preventDefault();
  }

  const initials = (lead.full_name || lead.email || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative shrink-0 border-l bg-background overflow-y-auto"
    >
      {/* Resize handle — left edge. */}
      <div
        onPointerDown={onHandlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        className={cn(
          "absolute top-0 left-0 z-10 h-full w-1.5 -ml-px cursor-col-resize select-none",
          "transition-colors hover:bg-accent/60",
          resizing && "bg-accent",
        )}
      />

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
            </div>
            {lead.email ? (
              <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                <span className="truncate">{lead.email}</span>
                <button
                  type="button"
                  onClick={() => copy(lead.email!)}
                  className="hover:text-foreground shrink-0"
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

        {tab === "details" ? <DetailsTab detail={detail} onCopy={copy} /> : null}
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

/* ------------------------------ details ------------------------------ */

function DetailsTab({
  detail,
  onCopy,
}: {
  detail: ThreadDetail;
  onCopy: (v: string) => void;
}) {
  const { lead } = detail;

  // Index custom_fields once, normalised, dropping empties.
  const entries = Object.entries(lead.custom_fields ?? {})
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => ({ key: k, nk: nkey(k), value: String(v).trim() }));

  const consumed = new Set<string>();
  const find = (...cands: string[]): string | null => {
    for (const c of cands) {
      const e = entries.find((x) => x.nk === c);
      if (e) {
        consumed.add(e.nk);
        return e.value;
      }
    }
    return null;
  };

  // ---- Card 1: general agent info ----
  const phone = find("phone", "phonenumber", "mobile", "cell", "mobilephone", "cellphone");
  const website = find(
    "website",
    "websiteurl",
    "homepage",
    "companysite",
    "companywebsite",
    "url",
    "companyurl",
  );
  let location = find("location", "city");
  const state = find("state", "region");
  if (location && state && !location.toLowerCase().includes(state.toLowerCase())) {
    location = `${location}, ${state}`;
  } else if (!location && state) {
    location = state;
  }
  const company = lead.company ?? find("company", "companyname", "organization");
  const title = lead.title ?? find("title", "jobtitle", "role", "position");

  // Mark identity keys consumed so they don't repeat in Card 2.
  for (const c of ["firstname", "lastname", "name", "fullname", "email", "companyname", "jobtitle"]) {
    if (entries.some((e) => e.nk === c)) consumed.add(c);
  }

  // ---- Card 2: everything else Instantly holds ----
  const card2: Array<{ label: string; value: string }> = [];
  if (title) card2.push({ label: "Title", value: title });
  if (lead.linkedin_url) card2.push({ label: "LinkedIn", value: lead.linkedin_url });
  for (const e of entries) {
    if (consumed.has(e.nk)) continue;
    card2.push({ label: prettifyKey(e.key), value: e.value });
  }

  const sourceLabel =
    detail.source_provider === "instantly"
      ? "Instantly"
      : detail.source_provider === "emailbison"
        ? "EmailBison"
        : null;

  return (
    <div className="space-y-3">
      {/* ---------------- Card 1 — Agent ---------------- */}
      <Card title="Agent" defaultOpen>
        <div className="space-y-px">
          <Field icon={Users} label="Name" value={lead.full_name} onCopy={onCopy} />
          <Field icon={MailIcon} label="Email" value={lead.email} onCopy={onCopy} />
          <Field icon={Phone} label="Phone" value={phone} onCopy={onCopy} />
          <Field icon={Building2} label="Company" value={company} onCopy={onCopy} />
          <Field icon={MapPin} label="Location" value={location} onCopy={onCopy} />
          <Field icon={Globe} label="Website" value={website} onCopy={onCopy} />
          <Field icon={Megaphone} label="Campaign" value={detail.campaign_name} onCopy={onCopy} />
          <Field icon={Users} label="Client" value={detail.client_name} onCopy={onCopy} />
          <Field icon={Inbox} label="Source" value={sourceLabel} />
        </div>

        {/* Provider-specific sequencing action. */}
        {detail.source_provider === "instantly" && detail.campaign_name ? (
          <div className="mt-3">
            <SubsequenceSection threadId={detail.id} />
          </div>
        ) : null}
        {detail.source_provider === "emailbison" ? (
          <div className="mt-3">
            <FollowupCampaignPicker threadId={detail.id} />
          </div>
        ) : null}
      </Card>

      {/* ---------------- Card 2 — Lead details ---------------- */}
      {card2.length > 0 ? (
        <Card title="Lead details" defaultOpen>
          <dl className="grid grid-cols-[minmax(96px,auto)_1fr] gap-x-3 gap-y-2 text-sm">
            {card2.map((row) => (
              <FieldPair
                key={`${row.label}-${row.value}`}
                label={row.label}
                value={row.value}
                onCopy={onCopy}
              />
            ))}
          </dl>
        </Card>
      ) : null}
    </div>
  );
}

// One labelled row in Card 1 — icon, label, value. Value wraps (never
// truncated) so long campaign names stay fully readable; URLs linkify.
function Field({
  icon: Icon,
  label,
  value,
  onCopy,
}: {
  icon: typeof MailIcon;
  label: string;
  value: string | null | undefined;
  onCopy?: (v: string) => void;
}) {
  if (!value) return null;
  return (
    <div className="group flex items-start gap-2.5 py-1.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-sm break-words leading-snug">
          <LinkValue value={value} />
        </div>
      </div>
      {onCopy ? (
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="mt-0.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-foreground"
          aria-label={`Copy ${label}`}
        >
          <Copy className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

// Compact key/value row for Card 2. The copy button sits inline with
// the value and only reveals itself on group-hover so the layout stays
// quiet at rest. `group/row` scopes the hover to this <dd>, not the
// surrounding card.
function FieldPair({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy?: (v: string) => void;
}) {
  return (
    <>
      <dt className="text-xs text-muted-foreground break-words pt-0.5">{label}</dt>
      <dd className="group/row flex items-start gap-2 break-words leading-snug">
        <div className="min-w-0 flex-1">
          <LinkValue value={value} />
        </div>
        {onCopy ? (
          <button
            type="button"
            onClick={() => onCopy(value)}
            className="mt-0.5 shrink-0 text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground hover:!text-foreground"
            aria-label={`Copy ${label}`}
          >
            <Copy className="size-3" />
          </button>
        ) : null}
      </dd>
    </>
  );
}

// Renders a URL value as a link, anything else as plain wrapped text.
function LinkValue({ value }: { value: string }) {
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v)) {
    return (
      <a
        href={v}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline break-all"
      >
        {v}
      </a>
    );
  }
  return <>{value}</>;
}

function prettifyKey(key: string): string {
  return key
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// Collapsible titled card.
function Card({
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
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold hover:bg-accent/40 transition-colors"
      >
        {title}
        {open ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open ? <div className="px-3 pb-3 pt-0.5">{children}</div> : null}
    </div>
  );
}
