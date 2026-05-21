"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Mail,
  Archive,
  ArchiveRestore,
  Trash2,
  RotateCcw,
  Reply as ReplyIcon,
  Reply,
  ReplyAll,
  Forward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/inbox/composer";
import { LabelPickerButton } from "@/components/inbox/label-picker";
import { SnoozeButton } from "@/components/inbox/snooze-button";
import { cn } from "@/lib/utils";
import type { ThreadDetail, MessageRow } from "@/lib/inbox/thread-detail";
import type { LabelRow } from "@/lib/inbox/labels-shared";

const COLLAPSED_HEIGHT_PX = 140;

function formatTime(ts: string | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = name || email || "?";
  return src
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ThreadView({
  detail,
  availableLabels = [],
  prevThreadHref = null,
  nextThreadHref = null,
  backHref = "..",
}: {
  detail: ThreadDetail;
  availableLabels?: LabelRow[];
  prevThreadHref?: string | null;
  nextThreadHref?: string | null;
  backHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // composeState tracks both reply + forward — they share the composer UI
  // but differ in initial To/body. null = composer closed.
  const [composeState, setComposeState] = useState<
    // Reply mode tracks BOTH the source message (per-message icon → that
    // message; bottom button → null = latest inbound) and a replyAll flag
    // that decides how we build the CC list (single message vs entire
    // thread participants).
    | { mode: "reply"; source: MessageRow | null; replyAll: boolean }
    | { mode: "forward"; source: MessageRow }
    | null
  >(null);
  const messages = detail.messages; // already ordered ascending (oldest first)
  const leadName = detail.lead.full_name ?? detail.lead.email ?? "Lead";
  const youName = "You";
  // OUR-side address pinned on the thread from the original webhook
  // (payload.sender_email.email). Always present once the thread has been
  // synced — use it for outbound rows where message.sender wasn't captured.
  const ourSenderEmail = detail.outbound_sender_email;

  async function bulkAction(body: object) {
    const res = await fetch("/api/threads/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  }
  async function markUnread() {
    const ok = await bulkAction({ action: "seen", thread_ids: [detail.id], seen: false });
    if (ok) startTransition(() => router.push(backHref));
  }
  const isArchived = detail.status === "archived";
  const isTrashed = detail.status === "trash";
  async function toggleArchive() {
    const nextStatus = isArchived ? "open" : "archived";
    const ok = await bulkAction({ action: "status", thread_ids: [detail.id], status: nextStatus });
    if (ok) startTransition(() => router.push(backHref));
  }
  async function toggleTrash() {
    if (!isTrashed && !confirm("Move this thread to trash?")) return;
    const nextStatus = isTrashed ? "open" : "trash";
    const ok = await bulkAction({ action: "status", thread_ids: [detail.id], status: nextStatus });
    if (ok) startTransition(() => router.push(backHref));
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-background relative">
      {/* Toolbar */}
      <div className="h-10 border-b flex items-center px-3 gap-1">
        <ToolbarIconButton icon={ChevronLeft} label="Back" href={backHref} />
        <ToolbarIconButton
          icon={ChevronUp}
          label="Previous"
          href={prevThreadHref ?? undefined}
          disabled={!prevThreadHref}
        />
        <ToolbarIconButton
          icon={ChevronDown}
          label="Next"
          href={nextThreadHref ?? undefined}
          disabled={!nextThreadHref}
        />
        <div className="flex-1" />
        <ToolbarIconButton
          icon={RefreshCw}
          label="Refresh"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
        />
        <LabelPickerButton
          threadId={detail.id}
          allLabels={availableLabels}
          assignedLabelIds={detail.labels.map((l) => l.id)}
        />
        <SnoozeButton
          threadId={detail.id}
          backHref={backHref}
          isSnoozed={detail.status === "reminder"}
          disabled={pending}
        />
        <ToolbarIconButton icon={Mail} label="Mark unread" onClick={markUnread} disabled={pending} />
        <ToolbarIconButton
          icon={isArchived ? ArchiveRestore : Archive}
          label={isArchived ? "Move to inbox" : "Archive"}
          onClick={toggleArchive}
          disabled={pending}
        />
        <ToolbarIconButton
          icon={isTrashed ? RotateCcw : Trash2}
          label={isTrashed ? "Restore from trash" : "Delete"}
          onClick={toggleTrash}
          disabled={pending}
        />
      </div>

      {/* Messages — oldest first, newest at bottom. Full pane width so
          inbound cards sit flush left and outbound flush right. */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-6 px-6 space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No messages in this thread yet.
            </p>
          ) : (
            messages.map((m) => (
              <MessageBlock
                key={m.id}
                message={m}
                leadName={leadName}
                leadEmail={detail.lead.email ?? null}
                youName={youName}
                ourSenderEmail={ourSenderEmail}
                onReply={() => setComposeState({ mode: "reply", source: m, replyAll: false })}
                onReplyAll={() => setComposeState({ mode: "reply", source: m, replyAll: true })}
                onForward={() => setComposeState({ mode: "forward", source: m })}
              />
            ))
          )}
        </div>
      </div>

      {/* Floating Reply */}
      <Button
        onClick={() => setComposeState({ mode: "reply", source: null, replyAll: false })}
        className="absolute bottom-4 right-4 gap-1.5 shadow-lg z-10"
      >
        <ReplyIcon className="size-4" />
        Reply
      </Button>

      {composeState ? (
        <Composer
          mode={composeState.mode}
          threadId={detail.id}
          signatureHtml={detail.outbound_sender_signature ?? null}
          sourceProvider={detail.source_provider}
          subject={
            composeState.mode === "forward"
              ? `Fwd: ${composeState.source.subject ?? detail.subject ?? ""}`
              : // Reply subject must match the message we're replying to,
                // not the thread's first-ever subject — otherwise on long
                // threads where the subject changed mid-stream (e.g. lead
                // moved into a subsequence with new outreach copy) the
                // outgoing email goes out with the stale original and
                // Gmail breaks threading on the recipient side.
                //
                // Two reply entry points:
                //   - per-message icon → composeState.source is that
                //     specific message; use ITS subject
                //   - floating bottom Reply button → source is null; use
                //     the latest inbound's subject
                ((): string => {
                  const sourceMsg =
                    composeState.source ??
                    [...detail.messages]
                      .reverse()
                      .find((m) => m.direction === "inbound");
                  const base = sourceMsg?.subject ?? detail.subject ?? "";
                  // Normalise to exactly one "Re: " prefix.
                  return /^re:\s/i.test(base) ? base : base ? `Re: ${base}` : "";
                })()
          }
          toEmail={composeState.mode === "forward" ? "" : detail.lead.email ?? ""}
          toName={composeState.mode === "forward" ? null : detail.lead.full_name ?? null}
          ccInitial={
            composeState.mode === "reply"
              ? buildReplyCcList(composeState, detail).join(", ")
              : ""
          }
          sourceMessageId={
            // Per-message Reply / Reply all → that specific message.
            // Bottom Reply button (source: null) → undefined; the API
            // will fall back to the latest inbound.
            composeState.mode === "reply" ? composeState.source?.id ?? null : null
          }
          draft={composeState.mode === "reply" ? detail.pending_draft : null}
          // Forward seeds the body with a quoted block of the source message
          // so the user just types their note above it.
          initialBody={composeState.mode === "forward" ? buildForwardBody(composeState.source, detail) : undefined}
          fromEmail={
            // Canonical OUR-side address pinned on the thread from the
            // webhook. Falls back to scanning outbound messages only if the
            // thread predates the column.
            detail.outbound_sender_email ??
            [...detail.messages].reverse().find((m) => m.direction === "outbound")?.sender ??
            null
          }
          fromName={detail.channel.display_name ?? null}
          quoted={(() => {
            if (composeState.mode === "forward") return null;
            const source =
              composeState.source ??
              [...detail.messages].reverse().find((m) => m.direction === "inbound");
            if (!source) return null;
            return {
              sender: detail.lead.full_name ?? detail.lead.email ?? null,
              sent_at: source.sent_at,
              body_text: source.body_text,
              body_html: source.body_html,
            };
          })()}
          onClose={() => setComposeState(null)}
        />
      ) : null}
    </section>
  );
}

function buildForwardBody(source: MessageRow, detail: ThreadDetail): string {
  const sender =
    source.direction === "inbound"
      ? detail.lead.full_name ?? detail.lead.email ?? "Unknown"
      : "You";
  const when = source.sent_at
    ? new Date(source.sent_at).toLocaleString()
    : "";
  const body = source.body_text ??
    (source.body_html ?? "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return [
    "",
    "",
    "---------- Forwarded message ----------",
    `From: ${sender} <${source.sender ?? ""}>`,
    `Date: ${when}`,
    `Subject: ${source.subject ?? "(no subject)"}`,
    "",
    body,
  ].join("\n");
}

// Extracts the CC list off a stored message's recipients jsonb. The sync
// code on EmailBison/Instantly normalises this to { to, cc, bcc } where cc
// is usually a string[] but can be null or a comma-joined string depending
// on which provider/handler wrote the row.
function ccsFromMessage(m: MessageRow): string[] {
  const r = (m.recipients ?? {}) as { cc?: unknown };
  const raw = r.cc;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string" && x.includes("@"));
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
  }
  return [];
}

// Builds the CC list for a Reply or Reply All composer pre-fill.
//
// Reply (replyAll=false): CC = sender + ccs of the SOURCE message (or the
//   latest inbound if source is null — that's the bottom Reply button case).
// Reply all (replyAll=true): CC = every unique non-us, non-lead participant
//   that has ever appeared as sender or in a cc field across the thread.
//
// In both cases we exclude the lead's address (it's the TO) and our own
// sending mailbox (don't email ourselves).
function buildReplyCcList(
  state: { mode: "reply"; source: MessageRow | null; replyAll: boolean },
  detail: ThreadDetail,
): string[] {
  const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const leadAddr = lower(detail.lead.email);
  const ourAddr = lower(detail.outbound_sender_email);
  const exclude = new Set([leadAddr, ourAddr].filter(Boolean));

  const collected = new Set<string>();
  const order: string[] = []; // preserve insertion order for predictable UI
  const add = (addr: string | null | undefined) => {
    const l = lower(addr);
    if (!l || !l.includes("@")) return;
    if (exclude.has(l)) return;
    if (collected.has(l)) return;
    collected.add(l);
    order.push((addr ?? "").trim());
  };

  if (state.replyAll) {
    for (const m of detail.messages) {
      add(m.sender);
      for (const cc of ccsFromMessage(m)) add(cc);
    }
  } else {
    const source =
      state.source ??
      [...detail.messages].reverse().find((m) => m.direction === "inbound") ??
      null;
    if (source) {
      add(source.sender);
      for (const cc of ccsFromMessage(source)) add(cc);
    }
  }
  return order;
}

function ToolbarIconButton({
  icon: Icon,
  label,
  href,
  onClick,
  disabled = false,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = cn(
    "size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
    disabled && "opacity-40 pointer-events-none",
  );
  if (href) {
    return (
      <a href={href} className={className} aria-label={label} title={label}>
        <Icon className="size-[15px]" strokeWidth={2} />
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={className}
      aria-label={label}
    >
      <Icon className="size-[15px]" strokeWidth={2} />
    </button>
  );
}

function MessageBlock({
  message,
  leadName,
  leadEmail,
  youName,
  ourSenderEmail,
  onReply,
  onReplyAll,
  onForward,
}: {
  message: MessageRow;
  leadName: string;
  leadEmail: string | null;
  youName: string;
  ourSenderEmail: string | null;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}) {
  const outbound = message.direction === "outbound";
  const [expanded, setExpanded] = useState(false);
  const senderLabel = outbound ? youName : leadName;
  // For outbound: use the row's sender if captured, else fall back to the
  // workspace's pinned OUR-side address (set from the webhook). For inbound:
  // use sender (lead's actual from) or fall back to the lead's email.
  const senderEmail = outbound
    ? message.sender ?? ourSenderEmail
    : message.sender ?? leadEmail;
  const senderInitials = initials(senderLabel, senderEmail);

  return (
    <div
      className={cn(
        // Direction-based alignment: outbound right, inbound left, max ~85% width
        "max-w-[88%]",
        outbound ? "ml-auto" : "mr-auto",
      )}
    >
      {/* Sender header */}
      <div
        className={cn(
          "flex items-center gap-2 text-xs pb-1.5",
          outbound ? "justify-end" : "justify-start",
        )}
      >
        {!outbound ? (
          <Avatar initials={senderInitials} className="bg-emerald-100 text-emerald-800" />
        ) : null}
        {senderEmail ? (
          <span className="text-muted-foreground">({senderEmail})</span>
        ) : null}
        <span className="font-medium text-foreground">{senderLabel}</span>
        {outbound ? <Avatar initials={senderInitials} className="bg-blue-500 text-white" /> : null}
      </div>

      {/* Message card */}
      <div
        className={cn(
          "rounded-xl border bg-card overflow-hidden",
          // Inbound cards have a subtle green tint to differentiate lead replies
          !outbound && "border-emerald-200/80 bg-emerald-50/30",
        )}
      >
        {/* Card header */}
        <div
          className={cn(
            "flex items-center justify-between px-4 py-2.5 border-b",
            !outbound && "border-emerald-200/60",
          )}
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">
              {message.subject || "(no subject)"}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatTime(message.sent_at)}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 text-muted-foreground">
            {/* Action icons only make sense on lead replies. On our own
                outbound sends, replying to ourselves is meaningless. */}
            {!outbound ? (
              <>
                <CardIcon icon={Reply} label="Reply" onClick={onReply} />
                <CardIcon icon={ReplyAll} label="Reply all" onClick={onReplyAll} />
                <CardIcon icon={Forward} label="Forward" onClick={onForward} />
              </>
            ) : null}
          </div>
        </div>

        {/* Body with collapse/expand */}
        <div className="relative">
          <div
            className="px-4 py-3 text-sm leading-relaxed overflow-hidden transition-[max-height] duration-150"
            style={{
              maxHeight: expanded ? "none" : `${COLLAPSED_HEIGHT_PX}px`,
            }}
          >
            {message.body_html ? (
              <div
                className="prose prose-sm max-w-none [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: message.body_html }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans">{message.body_text ?? ""}</pre>
            )}
          </div>
          {!expanded ? (
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent pointer-events-none",
                outbound ? "from-card" : "from-emerald-50/80",
              )}
            />
          ) : null}
        </div>

        {/* Expand chevron */}
        <div className="flex justify-center border-t py-0.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="size-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardIcon({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="size-7 rounded-md flex items-center justify-center hover:bg-accent hover:text-foreground transition-colors"
      aria-label={label}
    >
      <Icon className="size-3.5" strokeWidth={2} />
    </button>
  );
}

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "size-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0",
        className,
      )}
    >
      {initials}
    </span>
  );
}
