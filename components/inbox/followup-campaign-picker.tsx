"use client";

import { useState } from "react";
import { Loader2, ListPlus, Check } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FollowupCampaign {
  id: number;
  name: string;
  status: string | null;
}

// Button + dropdown for EmailBison threads. Lazy-loads the list of
// reply_followup campaigns in the thread's team, then on click pushes the
// thread's latest inbound reply (and its lead) into the selected campaign
// via POST /api/replies/{reply_id}/followup-campaign/push.
//
// Parallel to <SubsequencePicker /> which handles the equivalent
// Instantly flow.
export function FollowupCampaignPicker({ threadId }: { threadId: string }) {
  const [items, setItems] = useState<FollowupCampaign[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [movedIds, setMovedIds] = useState<Set<number>>(new Set());

  async function ensureLoaded() {
    if (items !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/${threadId}/followup-campaigns`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        items?: FollowupCampaign[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Failed to load follow-up campaigns");
        setItems([]);
        return;
      }
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function push(c: FollowupCampaign) {
    if (movingId) return;
    setMovingId(c.id);
    try {
      const res = await fetch(`/api/threads/${threadId}/followup-campaigns/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: c.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string | null;
      };
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Push failed");
        return;
      }
      toast.success(json.message ?? `Added to "${c.name}"`);
      setMovedIds((cur) => new Set(cur).add(c.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setMovingId(null);
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && ensureLoaded()}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 h-9 px-3 rounded-md border bg-background text-sm font-medium hover:bg-accent transition-colors"
          >
            <ListPlus className="size-3.5" />
            Add to follow-up campaign
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 max-h-72 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="px-3 py-3 text-sm text-red-600">{error}</div>
        ) : (items ?? []).length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            No reply follow-up campaigns in this EmailBison team. Create one
            with type &quot;reply_followup&quot; first.
          </div>
        ) : (
          (items ?? []).map((c) => {
            const moved = movedIds.has(c.id);
            const isMoving = movingId === c.id;
            return (
              <DropdownMenuItem
                key={c.id}
                disabled={isMoving || moved}
                onClick={() => push(c)}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate">{c.name}</div>
                  {c.status ? (
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {c.status}
                    </div>
                  ) : null}
                </div>
                {isMoving ? (
                  <Loader2 className="size-3.5 animate-spin shrink-0" />
                ) : moved ? (
                  <Check className="size-3.5 text-emerald-600 shrink-0" />
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
