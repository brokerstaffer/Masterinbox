"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CircleCheck,
  TriangleAlert,
  Trash2,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Follow Up Boss connect / disconnect card for the portal Settings
// page. Server-rendered shell passes in the current connection state;
// every state change goes through the PATCH/DELETE route at
// /api/portal/<token>/followup-boss which validates against FUB
// before persisting.

const FUB_DOCS_KEY_URL = "https://help.followupboss.com/hc/en-us/articles/360014289393-API-Key";

interface Props {
  token: string;
  connected: boolean;
  connectedAt: string | null;
}

export function FollowUpBossSettings({ token, connected: initialConnected, connectedAt: initialAt }: Props) {
  const router = useRouter();
  const [connected, setConnected] = useState(initialConnected);
  const [connectedAt, setConnectedAt] = useState<string | null>(initialAt);
  const [apiKey, setApiKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [account, setAccount] = useState<{ name: string | null; email: string | null } | null>(null);
  const [, startTransition] = useTransition();

  async function connect() {
    const trimmed = apiKey.trim();
    if (trimmed.length < 8) {
      setErrorMsg("Paste your Follow Up Boss API key first.");
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/${token}/followup-boss`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        account?: { name: string | null; email: string | null };
      };
      if (!res.ok || !json.ok) {
        setErrorMsg(
          json.error ?? "Couldn't connect to Follow Up Boss. Please try again.",
        );
        return;
      }
      setConnected(true);
      setConnectedAt(new Date().toISOString());
      setAccount(json.account ?? null);
      setApiKey("");
      toast.success("Connected to Follow Up Boss");
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  async function disconnect() {
    if (
      !confirm(
        "Disconnect Follow Up Boss? Leads marked as Introduction will stop syncing until you reconnect.",
      )
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/${token}/followup-boss`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not disconnect");
        return;
      }
      setConnected(false);
      setConnectedAt(null);
      setAccount(null);
      // Clear the form state inline (rather than in an effect) so the
      // disconnected card opens with a clean input.
      setApiKey("");
      setRevealKey(false);
      setErrorMsg(null);
      toast.success("Disconnected Follow Up Boss");
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#ebecf0] bg-white shadow-sm">
      {/* Header strip — gradient accent so the card reads as
          something the user manages, not a static info panel. */}
      <div className="relative border-b border-[#ebecf0] bg-gradient-to-br from-[#eaf2fd] via-white to-white px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#1565C0] text-white shadow-sm">
              <FubMark className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold tracking-tight text-[#0f1320]">
                Follow Up Boss
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[#5b6472]">
                Send every candidate marked as Introduction straight to your
                Follow Up Boss CRM.
              </p>
            </div>
          </div>
          <StatusPill connected={connected} />
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        {connected ? (
          <ConnectedView
            connectedAt={connectedAt}
            account={account}
            submitting={submitting}
            onDisconnect={disconnect}
          />
        ) : (
          <DisconnectedView
            apiKey={apiKey}
            reveal={revealKey}
            onChange={setApiKey}
            onToggleReveal={() => setRevealKey((v) => !v)}
            submitting={submitting}
            errorMsg={errorMsg}
            onSubmit={connect}
          />
        )}
      </div>
    </section>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        connected
          ? "bg-[#e9f7ef] text-[#0c8a4e]"
          : "bg-[#f5f7fa] text-[#5b6472]",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "bg-[#10b981]" : "bg-[#9aa0ab]",
        )}
      />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function DisconnectedView({
  apiKey,
  reveal,
  onChange,
  onToggleReveal,
  submitting,
  errorMsg,
  onSubmit,
}: {
  apiKey: string;
  reveal: boolean;
  onChange: (v: string) => void;
  onToggleReveal: () => void;
  submitting: boolean;
  errorMsg: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="fub-api-key"
          className="block text-[12.5px] font-semibold text-[#0f1320]"
        >
          API key
        </label>
        <div className="relative mt-1.5">
          <Input
            id="fub-api-key"
            value={apiKey}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste your Follow Up Boss API key"
            type={reveal ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            // text-[16px] keeps iOS Safari from focus-zooming the input
            className="h-11 pr-12 text-[16px] sm:text-[14px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
          />
          <button
            type="button"
            onClick={onToggleReveal}
            aria-label={reveal ? "Hide API key" : "Show API key"}
            className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-[#5b6472] transition-colors hover:bg-[#f6f7f9] hover:text-[#0f1320]"
          >
            {reveal ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-snug text-[#5b6472]">
          Find it in Follow Up Boss under <span className="font-medium text-[#0f1320]">My Settings → API</span>.{" "}
          <a
            href={FUB_DOCS_KEY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-[#1565C0] hover:underline"
          >
            View instructions
            <ExternalLink className="size-3" />
          </a>
        </p>
      </div>

      {errorMsg ? (
        <div className="flex items-start gap-2 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3.5 py-3 text-[12.5px] leading-snug text-[#b91c1c]">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{errorMsg}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={onSubmit}
          disabled={submitting || apiKey.trim().length < 8}
          className="min-w-[120px]"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Connect"
          )}
        </Button>
      </div>
    </div>
  );
}

function ConnectedView({
  connectedAt,
  account,
  submitting,
  onDisconnect,
}: {
  connectedAt: string | null;
  account: { name: string | null; email: string | null } | null;
  submitting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-[#f0fdf4] px-3.5 py-3">
        <CircleCheck className="mt-px size-5 shrink-0 text-[#10b981]" />
        <div className="min-w-0 text-[13px] leading-snug text-[#0f1320]">
          <div className="font-semibold">Follow Up Boss is connected.</div>
          <div className="mt-0.5 text-[#5b6472]">
            Every lead you move to{" "}
            <span className="font-medium text-[#0f1320]">Introduction</span>{" "}
            is sent automatically. You can also push individual leads from the
            Recruiting Pipeline.
            {connectedAt ? (
              <span className="block text-[11.5px] text-[#9aa0ab]">
                Connected on {formatConnectedAt(connectedAt)}
                {account?.email ? ` · ${account.email}` : ""}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onDisconnect}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12.5px] font-medium text-[#b91c1c] transition-colors hover:bg-[#fef2f2] disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          Disconnect
        </button>
      </div>
    </div>
  );
}

function formatConnectedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Tiny FUB mark — inline SVG so the card doesn't need an asset round-trip.
function FubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M6 4h12v3H10v4h7v3h-7v6H6V4Z"
        fill="currentColor"
      />
    </svg>
  );
}
