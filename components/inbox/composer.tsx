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
  quoted,
  draft,
  initialBody,
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
  // Controls the header label and a few minor UX bits.
  mode?: "reply" | "forward";
  // HTML signature from EmailBison for our sender account. When set + the
  // "Add signature" checkbox is on, we append this to the outgoing body.
  signatureHtml?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody ?? draft?.generated_body ?? "");
  const [usingDraft, setUsingDraft] = useState(
    !initialBody && Boolean(draft?.generated_body),
  );
  const [composerSubject, setComposerSubject] = useState(subject || "");
  const [to, setTo] = useState(toEmail);
  const [cc, setCc] = useState(ccInitial);
  const [bcc, setBcc] = useState("");
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
      setBody(json.body);
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
    if (!body.trim()) {
      toast.error("Write something to reply.");
      return;
    }
    setSending(true);
    try {
      // Plain-text body → HTML using <br> for every newline. Gmail's default
      // <p> styling collapses margins so paragraph wrappers lose the visual
      // blank line between blocks; <br><br> renders the user's intent 1:1.
      let bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");
      // Append the EmailBison signature when the user opted in. Signature
      // is already HTML — don't escape it.
      if (addSignature && signatureHtml && signatureHtml.trim().length > 0) {
        bodyHtml += `<br><br>${signatureHtml}`;
      }
      const toArr = to ? [{ email_address: to, name: toName ?? null }] : undefined;
      const ccArr = parseRecipients(cc);
      const bccArr = parseRecipients(bcc);

      let res: Response;
      if (files.length > 0) {
        // Multipart path — EmailBison's attachment endpoint needs the whole
        // request as multipart/form-data with scalars + JSON-stringified
        // recipients + repeated `attachments` file fields.
        const form = new FormData();
        form.append("body", bodyHtml);
        form.append("content_type", "html");
        if (composerSubject) form.append("subject", composerSubject);
        if (toArr) form.append("to", JSON.stringify(toArr));
        if (ccArr) form.append("cc", JSON.stringify(ccArr));
        if (bccArr) form.append("bcc", JSON.stringify(bccArr));
        form.append("reply_all", "0");
        form.append("inject_previous_email_body", "1");
        if (sourceMessageId) form.append("source_message_id", sourceMessageId);
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
            body: bodyHtml,
            content_type: "html",
            subject: composerSubject,
            to: toArr,
            cc: ccArr,
            bcc: bccArr,
            source_message_id: sourceMessageId ?? undefined,
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
    <div className="fixed inset-y-0 right-0 z-30 w-[640px] max-w-[100vw] bg-background border-l shadow-xl flex flex-col">
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
        {/* From */}
        <FieldRow label="From">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded border bg-muted/40 text-sm">
            <span className="size-4 rounded bg-red-500/90 text-white flex items-center justify-center text-[8px] font-bold">
              <Mail className="size-3" />
            </span>
            <span className="font-medium">{fromName ?? "You"}</span>
            {fromEmail ? (
              <span className="text-muted-foreground">({fromEmail})</span>
            ) : null}
          </div>
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
            placeholder="enter email address…"
            type="email"
            className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
          />
        </FieldRow>

        {showCc ? (
          <FieldRow label="Cc">
            <Input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="enter email address…"
              className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
            />
          </FieldRow>
        ) : null}

        {showBcc ? (
          <FieldRow label="Bcc">
            <Input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="enter email address…"
              className="flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm"
            />
          </FieldRow>
        ) : null}

        {/* Subject — locked in reply mode (see subjectLocked prop docs). */}
        <FieldRow
          label="Subject"
          right={
            subjectLocked ? null : (
              <button
                type="button"
                onClick={() => setComposerSubject("")}
                className="size-5 rounded-sm flex items-center justify-center text-muted-foreground hover:bg-accent"
                aria-label="Clear subject"
              >
                <X className="size-3.5" />
              </button>
            )
          }
        >
          <Input
            value={composerSubject}
            onChange={(e) => setComposerSubject(e.target.value)}
            readOnly={subjectLocked}
            tabIndex={subjectLocked ? -1 : undefined}
            title={subjectLocked ? "Subject is locked on replies to preserve email threading" : undefined}
            className={cn(
              "flex-1 h-7 border-0 bg-transparent shadow-none px-1 focus-visible:ring-0 text-sm",
              subjectLocked && "cursor-default text-foreground/80 pointer-events-none",
            )}
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
                setBody("");
                setUsingDraft(false);
              }}
              className="text-amber-900 hover:underline font-medium"
            >
              Clear & write from scratch
            </button>
          </div>
        ) : null}
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            // Once the user edits, drop the "draft" marker (they've taken ownership).
            if (usingDraft && e.target.value !== draft?.generated_body) setUsingDraft(false);
          }}
          placeholder="Enter your message…"
          rows={10}
          className="w-full min-h-[200px] resize-none text-sm bg-transparent outline-none placeholder:text-muted-foreground leading-relaxed"
          autoFocus
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
            onInsert={(tplBody) =>
              setBody((cur) => (cur.trim() ? `${cur}\n\n${tplBody}` : tplBody))
            }
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  category: string | null;
}

const UNCATEGORISED_LABEL = "Uncategorised";

// Footer "Templates" button — lazy-loads the workspace's reply templates
// on first open, grouped by category, then inserts the chosen one.
function TemplatePicker({ onInsert }: { onInsert: (body: string) => void }) {
  const [items, setItems] = useState<PickerTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);

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

  // Group by category — named categories alphabetically, uncategorised last.
  const groups: Array<{ category: string; templates: PickerTemplate[] }> = [];
  if (items) {
    const map = new Map<string, PickerTemplate[]>();
    for (const t of items) {
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
      <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : (items ?? []).length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No templates yet. Create them in Settings → Templates.
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
                  onClick={() => onInsert(t.body)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="text-sm font-medium">{t.name}</span>
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
