"use client";

import { useEffect, useState } from "react";
import { ListChecks } from "lucide-react";

interface Status {
  loading: boolean;
  inSubsequence: boolean;
  name: string | null;
  addedAt: string | null;
}

// Shows — when true — that the thread's lead is already sitting in an
// Instantly subsequence, so the user doesn't move them into one twice.
// Loads lazily on mount; renders nothing until/unless a subsequence is
// confirmed (no noise on the common "not in one" case).
export function SubsequenceStatus({ threadId }: { threadId: string }) {
  const [status, setStatus] = useState<Status>({
    loading: true,
    inSubsequence: false,
    name: null,
    addedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    setStatus({ loading: true, inSubsequence: false, name: null, addedAt: null });
    fetch(`/api/threads/${threadId}/subsequence-status`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { inSubsequence?: boolean; name?: string | null; addedAt?: string | null }) => {
        if (cancelled) return;
        setStatus({
          loading: false,
          inSubsequence: Boolean(j.inSubsequence),
          name: j.name ?? null,
          addedAt: j.addedAt ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setStatus((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (status.loading || !status.inSubsequence) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
      <ListChecks className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          Already in a subsequence
        </div>
        <div className="text-[13px] font-medium break-words">
          {status.name ?? "Active subsequence"}
        </div>
        {status.addedAt ? (
          <div className="text-[11px] text-amber-700/80">
            Added {fmtAdded(status.addedAt)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function fmtAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
