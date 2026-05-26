"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Subscribes to Supabase Realtime for the active workspace and refreshes the
// current server-rendered route whenever a new thread or message lands. Uses
// router.refresh() so we re-fetch data without a full page reload — client
// state (open dialogs, composer drafts, scroll position) is preserved.
//
// Listens to:
//   - threads INSERT     (new conversation arrives)
//   - messages INSERT    (new message lands on an existing thread)
//   - label_assignments INSERT (server-side labeling assigns a label)
//
// Polling fallback: every POLL_MS we also fire a router.refresh() regardless
// of realtime status. Supabase Realtime has known JWT-timing / reconnection
// edge cases — the poll guarantees the user never has to hit refresh
// manually. Paused while the tab is hidden so background tabs stay quiet.
//
// 30s is a safety net only. Realtime INSERT events still trigger an
// immediate refresh; the poll exists purely to recover from a dropped
// websocket. Halving the cadence (from 15s) cuts baseline server load
// in half without users noticing — new threads still arrive in seconds
// via the realtime path.

const POLL_MS = 30_000;

export function RealtimeRefresher({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  // Coalesce a burst of changes into one router.refresh() call so we don't
  // hammer the server when a webhook fires multiple table writes in a row.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function schedule() {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        router.refresh();
      }, 250);
    }

    const poll = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, POLL_MS);

    // CRITICAL: do NOT subscribe to threads UPDATE. The detail page fires
    // a `seen=true` UPDATE on every navigation, and that event would
    // trigger router.refresh() ~250ms later — which races against the
    // in-flight client-side navigation and silently cancels it. This
    // produced the "click another thread, blue dot disappears, but page
    // doesn't change" bug. Only listen for events that surface NEW data
    // the user couldn't see: new threads, new messages, new labels.
    const channel = supabase
      .channel(`workspace:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "threads",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        schedule,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        schedule,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "label_assignments",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        schedule,
      )
      .subscribe();

    return () => {
      if (pending.current) clearTimeout(pending.current);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  return null;
}
