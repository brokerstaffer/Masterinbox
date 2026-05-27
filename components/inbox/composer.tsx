"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  X,
  Paperclip,
  Image as ImageIcon,
  Sparkles,
  Mail,
  File as FileIcon,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  substituteVariables,
  type SubstitutionContext,
} from "@/lib/inbox/template-variables";
import {
  ComposerBodyEditor,
  type ComposerBodyHandle,
} from "@/components/inbox/composer-body-editor";

const PER_FILE_MAX = 25 * 1024 * 1024; // 25 MB
const COMBINED_MAX = 50 * 1024 * 1024; // 50 MB

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

interface QuotedMessage {
  sender: string | null;
  sent_at: string | null;
  body_text: string | null;
  body_html: string | null;
}

interface DraftSeed {
  id: string;
  agent_name: string | null;
  generated_body: string | null;
}

export function Composer({
  threadId,
  subject,
  toEmail,
  toName,
  fromEmail,
  fromName,
  leadCompany = null,
  leadTitle = null,
  channels = [],
  quoted,
  draft,
  initialBody,
  forwardedBlock = null,
  mode = "reply",
  signatureHtml = null,
  sourceProvider = null,
  subjectLocked = false,
  ccInitial = "",
  sourceMessageId = null,
  onClose,
}: {
  threadId: string;
  subject: string;
  toEmail: string;
  toName?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  // Optional lead enrichment for template-variable substitution. When
  // a template body uses {{lead.company}} or {{lead.title}}, these
  // values fill the placeholder; missing values leave the placeholder
  // in the inserted body so the user notices and can fix manually.
  leadCompany?: string | null;
  leadTitle?: string | null;
  // All connected sender mailboxes for this workspace. Drives the From
  // dropdown — user can override which mailbox the message is sent
  // from (defaults to the thread's pinned sender).
  channels?: ChannelOption[];
  quoted?: QuotedMessage | null;
  draft?: DraftSeed | null;
  // Provider this thread came from. Drives provider-specific UX: Instantly
  // does not support sending attachments, so we hide the Attach buttons for
  // Instantly threads. EmailBison keeps them.
  sourceProvider?: "emailbison" | "instantly" | null;
  // When true, the Subject field is rendered read-only — used on Reply so
  // the user can't accidentally retype the subject and break recipient-
  // side threading (Gmail/Outlook use subject + In-Reply-To to thread).
  // Forward mode leaves this off so the user can fully edit.
  subjectLocked?: boolean;
  // Comma-separated CC addresses to pre-fill. Caller (thread-view) builds
  // this from the source message's sender + ccs (Reply) or every thread
  // participant (Reply all). When non-empty, the CC row auto-opens so the
  // user can see who's getting looped in before sending.
  ccInitial?: string;
  // messages.id of the message the user clicked Reply on (per-message
  // icon). Sent to the /reply API so it uses THAT message's provider id
  // as the reply target — required for recipient-side threading when
  // replying to an older message. Null = bottom Reply button → API falls
  // back to the latest inbound.
  sourceMessageId?: string | null;
  // Pre-fills the body — used by Forward to seed the quoted block before
  // the user adds their own note above it. Takes priority over draft.
  initialBody?: string;
  // The raw forwarded-message block (the "---------- Forwarded message …"
  // quote of the source). When in forward mode this is kept separately
  // from `initialBody` so that if the user clears the body before
  // sending, we can guarantee the original message still rides along.
  forwardedBlock?: string | null;
  // Controls the header label and a few minor UX bits.
  mode?: "reply" | "forward";
  // HTML signature from EmailBison for our sender account. When set + the
  // "Add signature" checkbox is on, we append this to the outgoing body.
  signatureHtml?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  // Body is rich-text (HTML). bodyText is the plain-text projection
  // TipTap gives us — used for empty-body checks and the forward-marker
  // safety net (which scans for the "----- Forwarded message -----"
  // string regardless of formatting).
  const initialPlain = initialBody ?? draft?.generated_body ?? "";
  const editorRef = useRef<ComposerBodyHandle | null>(null);
  const [bodyHtml, setBodyHtml] = useState<string>(() =>
    initialPlain ? plainTextToHtml(initialPlain) : "",
  );
  const [bodyText, setBodyText] = useState<string>(initialPlain);
  const [usingDraft, setUsingDraft] = useState(
    !initialBody && Boolean(draft?.generated_body),
  );
  const [composerSubject, setComposerSubject] = useState(subject || "");
  const [to, setTo] = useState(toEmail);
  const [cc, setCc] = useState(ccInitial);
  const [bcc, setBcc] = useState("");
  // Pre-select the channel whose display_name / instantly_account_id
  // matches the thread's pinned sender. Falls back to null (use the
  // thread's default) when no match — typically because the channel
  // pinned on the thread is no longer in the workspace's channel list.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    () => {
      if (!fromEmail) return null;
      const match = channels.find(
        (c) =>
          c.display_name.toLowerCase() === fromEmail.toLowerCase() ||
          (c.instantly_account_id ?? "").toLowerCase() === fromEmail.toLowerCase(),
      );
      return match?.id ?? null;
    },
  );
  // Auto-open the CC row when we pre-filled it — otherwise the user has no
  // visual signal that anyone's being looped in.
  const [showCc, setShowCc] = useState(ccInitial.trim().length > 0);
  const [showBcc, setShowBcc] = useState(false);
  const [addSignature, setAddSignature] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  async function generateAiReply() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/threads/${threadId}/generate-draft`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.body) {
        toast.error(json.error ?? "Could not generate a draft.");
        return;
      }
      // AI returns plain text — convert to HTML preserving paragraph
      // breaks so the rich editor can show it sensibly.
      const html = plainTextToHtml(json.body);
      editorRef.current?.setContent(html);
      setBodyHtml(html);
      setBodyText(json.body);
      setUsingDraft(true);
      toast.success(`Draft by ${json.agent_name ?? "Reply Agent"}`);
    } catch {
      toast.error("Could not generate a draft.");
    } finally {
      setGenerating(false);
    }
  }

  function addFiles(next: FileList | File[] | null) {
    if (!next) return;
    const incoming = Array.from(next);
    const merged: File[] = [...files];
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of incoming) {
      if (f.size > PER_FILE_MAX) {
        toast.error(`"${f.name}" exceeds the 25MB per-file limit.`);
        continue;
      }
      if (merged.some((m) => m.name === f.name && m.size === f.size)) continue;
      if (total + f.size > COMBINED_MAX) {
        toast.error("Combined attachments exceed the 50MB limit.");
        break;
      }
      merged.push(f);
      total += f.size;
    }
    setFiles(merged);
  }

  function removeFile(name: string) {
    setFiles((cur) => cur.filter((f) => f.name !== name));
  }

  async function onSend() {
    // On replies, force the user to write something — sending an empty
    // reply is almost always a mistake. On forwards, an empty body is
    // legitimate (the original message is the payload), and we re-attach
    // the forwarded block below regardless.
    const isForward = mode === "forward";
    if (!isForward && !bodyText.trim()) {
      toast.error("Write something to reply.");
      return;
    }
    setSending(true);
    try {
      // bodyHtml is already real HTML from the rich-text editor. Forward
      // safety net: if the user cleared the editor (or deleted the
      // pre-filled quoted block), re-attach the original message so the
      // forward isn't an empty email. Marker check runs on the plain
      // text projection so formatting changes don't fool it.
      let finalHtml = bodyHtml;
      const FORWARD_MARKER = "---------- Forwarded message ----------";
      if (isForward && forwardedBlock && !bodyText.includes(FORWARD_MARKER)) {
        const quotedHtml = plainTextToHtml(forwardedBlock);
        finalHtml = finalHtml.trim().length > 0
          ? `${finalHtml}<br><br>${quotedHtml}`
          : quotedHtml;
      }
      // Append the EmailBison signature when the user opted in.
      // Signature is already HTML — don't escape it.
      if (addSignature && signatureHtml && signatureHtml.trim().length > 0) {
        finalHtml += `<br><br>${signatureHtml}`;
      }
      // Naming kept to minimise the diff with the existing send path.
      const bodyHtmlToSend = finalHtml;
      // Parse the TO field the same way CC/BCC are parsed so multiple
      // comma/semicolon-separated addresses work. Single-recipient mode
      // (the common reply case) still produces a one-element array.
      // We preserve the `toName` only when the user didn't expand TO into
      // multiple addresses — once it's a list, names aren't paired any
      // more and EmailBison just wants the addresses.
      const parsedTo = parseRecipients(to);
      const toArr = parsedTo
        ? parsedTo.length === 1 && toName
          ? [{ email_address: parsedTo[0].email_address, name: toName }]
          : parsedTo
        : undefined;
      const ccArr = parseRecipients(cc);
      const bccArr = parseRecipients(bcc);

      let res: Response;
      if (files.length > 0) {
        // Multipart path — EmailBison's attachment endpoint needs the whole
        // request as multipart/form-data with scalars + JSON-stringified
        // recipients + repeated `attachments` file fields.
        const form = new FormData();
        form.append("body", bodyHtmlToSend);
        form.append("content_type", "html");
        if (composerSubject) form.append("subject", composerSubject);
        if (toArr) form.append("to", JSON.stringify(toArr));
        if (ccArr) form.append("cc", JSON.stringify(ccArr));
        if (bccArr) form.append("bcc", JSON.stringify(bccArr));
        form.append("reply_all", "0");
        form.append("inject_previous_email_body", "1");
        if (sourceMessageId) form.append("source_message_id", sourceMessageId);
        if (selectedChannelId) form.append("sender_channel_id", selectedChannelId);
        for (const f of files) form.append("attachments", f, f.name);
        res = await fetch(`/api/threads/${threadId}/reply`, {
          method: "POST",
          body: form,
        });
      } else {
        res = await fetch(`/api/threads/${threadId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: bodyHtmlToSend,
            content_type: "html",
            subject: composerSubject,
            to: toArr,
            cc: ccArr,
            bcc: bccArr,
            source_message_id: sourceMessageId ?? undefined,
            sender_channel_id: selectedChannelId ?? undefined,
          }),
        });
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.detail
          ? `${json.error ?? "Send failed"}: ${json.detail}`
          : json.error ?? "Send failed";
        toast.error(msg);
        console.error("[composer] send failed:", json);
        return;
      }
      toast.success("Reply sent");
      router.refresh();
      onClose();
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
    }
  }

  const replyTitle = toName ?? toEmail;
  const headerLabel =
    mode === "forward"
      ? `Forward${subject ? `: ${subject}` : ""}`
      : `Reply to "${replyTitle || "..."}"`;

  return (
    // At lg+ the composer is a flex child sitting next to the messages
    // column so the prospect panel on the page's right stays visible
    // while drafting. Below lg there isn't room — fall back to the
    // original full-height fixed overlay so phones / narrow viewports
    // still work.
    <div className="fixed inset-y-0 right-0 z-30 w-[640px] max-w-[100vw] shadow-xl lg:static lg:inset-auto lg:z-auto lg:w-[480px] lg:max-w-none lg:shadow-none bg-background border-l flex flex-col shrink-0">
      {/* Header */}
      <div className="h-12 border-b flex items-center px-4 justify-between shrink-0">
        <h3 className="text-sm font-semibold truncate">{headerLabel}</h3>
        <button
          type="button"
          onClick={onClose}
          className="size-8 rounded-md flex items-center justify-center hover:bg-accent"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Header fields */}
      <div className="px-4 py-3 space-y-2 text-sm border-b shrink-0">
        {/* From — pre-filled with the thread's sender; click to override
            with any other connected mailbox on the same provider. */}
        <FieldRow label="From">
          <SenderPicker
            channels={channels}
            sourceProvider={sourceProvider}
            defaultEmail={fromEmail ?? null}
            defaultName={fromName ?? null}
            selectedId={selectedChannelId}
            onChange={setSelectedChannelId}
          />
        </FieldRow>

        {/* To + Cc/Bcc toggles */}
        <FieldRow
          label="To"
          right={
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setShowCc((v) => !v)}
                className="hover:text-foreground"
              >
                Cc
              </button>
              <button
                type="button"
                onClick={() => setShowBcc((v) => !v)}
                className="hover:text-foreground"
              >
                Bcc
              </button>
            </div>
          }
        >
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="email address (separate multiple with commas)"
            // Note: type="email" blocks commas via browser validation,
            // which silently breaks multi-recipient sends — keep as
            // plain text.
            type="text"
            className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
          />
        </FieldRow>

        {showCc ? (
          <FieldRow label="Cc">
            <Input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="email addresses (separate multiple with commas)"
              className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
            />
          </FieldRow>
        ) : null}

        {showBcc ? (
          <FieldRow label="Bcc">
            <Input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="email addresses (separate multiple with commas)"
              className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
            />
          </FieldRow>
        ) : null}

        {/* Subject — pre-filled but always editable. On replies, changing
            the subject can break Gmail/Outlook threading on the
            recipient side; surfaced as a tooltip rather than locking. */}
        <FieldRow
          label="Subject"
          right={
            <button
              type="button"
              onClick={() => setComposerSubject("")}
              className="size-5 rounded-sm flex items-center justify-center text-muted-foreground hover:bg-accent"
              aria-label="Clear subject"
            >
              <X className="size-3.5" />
            </button>
          }
        >
          <Input
            value={composerSubject}
            onChange={(e) => setComposerSubject(e.target.value)}
            title={
              mode === "reply"
                ? "Changing the subject on a reply may break threading on the recipient's side"
                : undefined
            }
            className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
            placeholder="(no subject)"
          />
        </FieldRow>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {usingDraft && draft?.generated_body ? (
          <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs">
            <span className="text-amber-900">
              Draft by <span className="font-medium">{draft.agent_name ?? "Reply Agent"}</span> — review before sending.
            </span>
            <button
              type="button"
              onClick={() => {
                editorRef.current?.setContent("");
                setBodyHtml("");
                setBodyText("");
                setUsingDraft(false);
              }}
              className="text-amber-900 hover:underline font-medium"
            >
              Clear &amp; write from scratch
            </button>
          </div>
        ) : null}
        <ComposerBodyEditor
          ref={editorRef}
          initialHtml={bodyHtml}
          placeholder="Enter your message…"
          onChange={({ html, text }) => {
            setBodyHtml(html);
            setBodyText(text);
            // Once the user types, drop the "draft" marker (they've taken
            // ownership of the body).
            if (usingDraft && html !== plainTextToHtml(draft?.generated_body ?? "")) {
              setUsingDraft(false);
            }
          }}
        />

        {/* Quoted last message */}
        {quoted && (quoted.body_text || quoted.body_html) ? (
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-2">
              On {formatQuotedTimestamp(quoted.sent_at)}, {quoted.sender ?? "the lead"} wrote:
            </p>
            <blockquote className="text-sm text-muted-foreground border-l-2 pl-3 whitespace-pre-wrap">
              {(quoted.body_text ?? stripHtml(quoted.body_html ?? "")).slice(0, 2000)}
            </blockquote>
          </div>
        ) : null}
      </div>

      {/* Attachment chips */}
      {files.length > 0 ? (
        <div className="px-4 py-2 border-t flex flex-wrap gap-1.5 shrink-0">
          {files.map((f) => (
            <span
              key={f.name + f.size}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-muted/50 text-xs"
            >
              <FileIcon className="size-3.5 text-muted-foreground" />
              <span className="max-w-[180px] truncate">{f.name}</span>
              <span className="text-muted-foreground">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(f.name)}
                className="ml-0.5 size-4 rounded flex items-center justify-center hover:bg-background"
                aria-label={`Remove ${f.name}`}
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Signature toggle — only rendered when we actually have one to append. */}
      {signatureHtml && signatureHtml.trim().length > 0 ? (
        <div className="px-4 py-2.5 border-t flex items-center gap-2 shrink-0">
          <Checkbox
            checked={addSignature}
            onCheckedChange={(v) => setAddSignature(Boolean(v))}
          />
          <span className="text-xs text-muted-foreground">
            Add signature of the email account
          </span>
        </div>
      ) : null}

      {/* Hidden file inputs — driven by the toolbar icons */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          if (e.target) e.target.value = "";
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          if (e.target) e.target.value = "";
        }}
      />

      {/* Footer toolbar + Send */}
      <div className="px-4 py-3 border-t flex items-center justify-between shrink-0">
        <div className="flex items-center gap-0.5 text-muted-foreground">
          {sourceProvider !== "instantly" ? (
            <>
              <IconButton
                icon={Paperclip}
                label="Attach file"
                onClick={() => fileInputRef.current?.click()}
              />
              <IconButton
                icon={ImageIcon}
                label="Attach image"
                onClick={() => imageInputRef.current?.click()}
              />
            </>
          ) : null}
          <button
            type="button"
            onClick={generateAiReply}
            disabled={generating}
            aria-label="Generate AI reply"
            title="Generate AI reply"
            className="h-8 px-2 inline-flex items-center gap-1.5 rounded-md border bg-background text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generating ? "Generating…" : "AI reply"}
          </button>
          <TemplatePicker
            substitutionContext={{
              lead: {
                name: toName ?? null,
                email: toEmail,
                company: leadCompany,
                title: leadTitle,
              },
              thread: { subject: composerSubject },
              sender: { name: fromName ?? null, email: fromEmail ?? null },
            }}
            onApply={(t) => {
              // Insert the template's HTML at the caret so any existing
              // text the user typed is preserved. If the editor is
              // currently empty, insertContent simply places it at the
              // start.
              if (t.bodyHtml) {
                editorRef.current?.insertContent(t.bodyHtml);
              }
              // Subject: apply the template's subject only when the
              // composer doesn't already have one the user has typed/
              // personalised (don't clobber their work).
              if (t.subject && !composerSubject.trim()) {
                setComposerSubject(t.subject);
              }
              const tplCc = t.cc;
              if (tplCc) {
                setCc((cur) => mergeRecipientStrings(cur, tplCc));
                setShowCc(true);
              }
              const tplBcc = t.bcc;
              if (tplBcc) {
                setBcc((cur) => mergeRecipientStrings(cur, tplBcc));
                setShowBcc(true);
              }
            }}
          />
        </div>
        <Button onClick={onSend} disabled={sending} className="gap-1.5">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send
        </Button>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
  right,
}: {
  label: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 min-h-7">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}:</span>
      <div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">{children}</div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}


function IconButton({
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
      aria-label={label}
      className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      <Icon className="size-[15px]" strokeWidth={2} />
    </button>
  );
}

function formatQuotedTimestamp(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Parse a comma- or whitespace-separated string of email addresses into
// EmailBison's recipient array shape. Empty input → undefined (omit).
function parseRecipients(
  input: string,
): Array<{ email_address: string; name?: string | null }> | undefined {
  const tokens = input
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && /@/.test(t));
  if (tokens.length === 0) return undefined;
  return tokens.map((email_address) => ({ email_address }));
}

// Merge two CC/BCC strings, dedup case-insensitively, preserve order.
// Used when a template carries its own CC/BCC and we don't want to
// clobber whatever the user already typed manually.
function mergeRecipientStrings(existing: string, incoming: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    for (const tok of raw.split(/[,;\s]+/)) {
      const t = tok.trim();
      if (!t || !/@/.test(t)) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  };
  push(existing);
  push(incoming);
  return out.join(", ");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Plain-text → HTML, preserving paragraph + line breaks so the rich
// editor (and the eventual email recipient) sees the same visual
// structure the user typed. Single newlines become <br>; blank lines
// become paragraph breaks. Safe to feed into the editor's
// initialHtml or insertContent.
function plainTextToHtml(s: string): string {
  if (!s) return "";
  const paragraphs = s.split(/\n{2,}/).map((para) => {
    const inner = escapeHtml(para).replace(/\n/g, "<br>");
    return `<p>${inner || "<br>"}</p>`;
  });
  return paragraphs.join("");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PickerTemplate {
  id: string;
  name: string;
  body: string;
  body_html: string | null;
  subject: string | null;
  cc: string | null;
  bcc: string | null;
  category: string | null;
}

const UNCATEGORISED_LABEL = "Uncategorised";

interface AppliedTemplate {
  // HTML body to insert at the editor's caret. Variables already
  // substituted. Falls back to plaintextToHtml(t.body) when the
  // template has no body_html (older rows).
  bodyHtml: string;
  subject: string | null;
  cc: string | null;
  bcc: string | null;
}

// Footer "Templates" button — lazy-loads the workspace's reply templates
// on first open, applies variable substitution against the current
// thread context, and hands the whole payload to the composer so it
// can populate subject / cc / bcc / body in one shot.
function TemplatePicker({
  substitutionContext,
  onApply,
}: {
  substitutionContext: SubstitutionContext;
  onApply: (t: AppliedTemplate) => void;
}) {
  const [items, setItems] = useState<PickerTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  async function ensureLoaded() {
    if (items !== null || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/reply-templates", { cache: "no-store" });
      const json = (await res.json()) as { templates?: PickerTemplate[] };
      setItems(json.templates ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // Filter by name / subject / body / category.
  const filtered = (items ?? []).filter((t) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return [t.name, t.subject, t.body, t.category]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  // Group by category — named categories alphabetically, uncategorised last.
  const groups: Array<{ category: string; templates: PickerTemplate[] }> = [];
  {
    const map = new Map<string, PickerTemplate[]>();
    for (const t of filtered) {
      const cat = (t.category ?? "").trim() || UNCATEGORISED_LABEL;
      const list = map.get(cat) ?? [];
      list.push(t);
      map.set(cat, list);
    }
    groups.push(
      ...[...map.entries()]
        .map(([category, templates]) => ({ category, templates }))
        .sort((a, b) => {
          if (a.category === UNCATEGORISED_LABEL) return 1;
          if (b.category === UNCATEGORISED_LABEL) return -1;
          return a.category.localeCompare(b.category);
        }),
    );
  }

  function apply(t: PickerTemplate) {
    const subst = (s: string | null) =>
      s ? substituteVariables(s, substitutionContext) : null;
    // Prefer the rich HTML body when the template has one. Older rows
    // only have the plain `body` column — wrap that in basic HTML so
    // the editor still renders paragraph breaks correctly.
    const rawHtml =
      t.body_html && t.body_html.trim().length > 0
        ? t.body_html
        : plainTextToHtml(
            (t.body ?? "").replace(/\n{3,}/g, "\n\n").trim(),
          );
    const substitutedHtml = substituteVariables(rawHtml, substitutionContext);
    onApply({
      bodyHtml: substitutedHtml,
      subject: subst(t.subject),
      cc: subst(t.cc),
      bcc: subst(t.bcc),
    });
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && ensureLoaded()}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Insert template"
            title="Insert a saved template"
            className="h-8 px-2 inline-flex items-center gap-1.5 rounded-md border bg-background text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <FileText className="size-3.5" />
            Templates
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto p-0">
        <div className="sticky top-0 z-10 border-b bg-background p-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search templates…"
            autoFocus
            className="w-full h-8 rounded-md border bg-background px-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        {loading ? (
          <div className="px-3 py-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : (items ?? []).length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No templates yet. Create them in Settings → Templates.
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No templates match &quot;{filter}&quot;.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.category}>
              <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.category}
              </div>
              {g.templates.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => apply(t)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.subject ? (
                    <span className="text-[10.5px] text-muted-foreground/80">
                      Subject: {t.subject}
                    </span>
                  ) : null}
                  <span className="text-[11px] text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {t.body || "(empty)"}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Shape of the channel rows the composer cares about — display + the
// provider-specific identifiers. Loaded by the parent and passed down
// via the `channels` prop. Kept exported so thread-view can satisfy
// the type without restating the fields.
export interface ChannelOption {
  id: string;
  provider: "instantly" | "emailbison" | "unipile";
  display_name: string;
  instantly_account_id: string | null;
}

// Searchable From-dropdown. Filters channels to the same provider as
// the thread (cross-provider sends aren't supported by the underlying
// APIs), shows display_name + email, and lets the user override the
// pinned sender on this thread for a single send.
function SenderPicker({
  channels,
  sourceProvider,
  defaultEmail,
  defaultName,
  selectedId,
  onChange,
}: {
  channels: ChannelOption[];
  sourceProvider: "instantly" | "emailbison" | null;
  defaultEmail: string | null;
  defaultName: string | null;
  selectedId: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  // Limit the picker to mailboxes that can actually be used for this
  // thread's provider. Mixed-provider sends aren't supported by the
  // underlying APIs.
  const available = channels.filter(
    (c) => !sourceProvider || c.provider === sourceProvider,
  );

  const selected = selectedId
    ? available.find((c) => c.id === selectedId) ?? null
    : null;

  // Display string for the trigger button — prefers the picked channel,
  // falls back to whatever the parent told us is the default sender.
  const triggerLabel =
    selected?.display_name ?? defaultEmail ?? defaultName ?? "Choose sender";
  const triggerSubLabel = selected ? "" : defaultName ?? "";

  const filtered = filter.trim()
    ? (() => {
        const needle = filter.trim().toLowerCase();
        return available.filter((c) => {
          // display_name covers names + emails-as-names (Instantly stores
          // the email there too). instantly_account_id is literally the
          // email for Instantly channels — search that explicitly so
          // typing the @domain portion of a sender's address matches.
          if (c.display_name.toLowerCase().includes(needle)) return true;
          if (
            c.instantly_account_id &&
            c.instantly_account_id.toLowerCase().includes(needle)
          ) {
            return true;
          }
          return false;
        });
      })()
    : available;

  if (available.length <= 1) {
    // Nothing to pick from — render read-only with the default.
    return (
      <div className="flex items-center gap-2 px-2.5 py-1 rounded border bg-muted/40 text-sm">
        <span className="size-4 rounded bg-red-500/90 text-white flex items-center justify-center text-[8px] font-bold">
          <Mail className="size-3" />
        </span>
        <span className="font-medium">{defaultName ?? "You"}</span>
        {defaultEmail ? (
          <span className="text-muted-foreground">({defaultEmail})</span>
        ) : null}
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded border bg-background text-sm hover:bg-accent transition-colors"
            aria-label="Choose sender mailbox"
            title="Click to change the sender mailbox"
          >
            <span className="size-4 rounded bg-red-500/90 text-white flex items-center justify-center text-[8px] font-bold">
              <Mail className="size-3" />
            </span>
            <span className="font-medium truncate max-w-[260px]">
              {triggerLabel}
            </span>
            {triggerSubLabel ? (
              <span className="text-muted-foreground truncate max-w-[160px]">
                ({triggerSubLabel})
              </span>
            ) : null}
            <span className="text-muted-foreground text-[10px]">▾</span>
          </button>
        }
      />
      <DropdownMenuContent
        align="start"
        className="w-[360px] max-h-[400px] overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-10 border-b bg-background p-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            // base-ui's Menu intercepts every keystroke for ARIA
            // typeahead (jumping to items starting with the letter),
            // which is why typing "j" used to send focus to the first
            // "John" item instead of going into this input. Stopping
            // propagation on keydown + pointerdown keeps the input
            // owning its own events.
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder={`Search ${available.length} sender${available.length === 1 ? "" : "s"}…`}
            autoFocus
            className="w-full h-8 rounded-md border bg-background px-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        {defaultEmail ? (
          <DropdownMenuItem
            onClick={() => {
              onChange(null);
              setFilter("");
              setOpen(false);
            }}
            className="flex flex-col items-start gap-0 border-b text-[12px]"
          >
            <span className="font-medium">Use thread default</span>
            <span className="text-muted-foreground">{defaultEmail}</span>
          </DropdownMenuItem>
        ) : null}
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No senders match &quot;{filter}&quot;.
          </div>
        ) : (
          filtered.slice(0, 200).map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => {
                onChange(c.id);
                setFilter("");
                setOpen(false);
              }}
              className="flex items-center justify-between gap-2 text-[13px]"
            >
              <span className="truncate">{c.display_name}</span>
              {c.id === selectedId ? (
                <span className="text-[10px] text-[#1565C0] font-semibold uppercase">
                  Selected
                </span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        {filtered.length > 200 ? (
          <div className="px-3 py-1.5 text-center text-[11px] text-muted-foreground border-t">
            {filtered.length - 200} more — refine your search to see them
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
