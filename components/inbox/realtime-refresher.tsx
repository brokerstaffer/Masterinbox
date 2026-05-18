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
//   - threads INSERT/UPDATE  (new conversation or last_message_at change)
//   - messages INSERT        (new message arrives)
//
// All scoped to the active workspace_id via PostgreSQL `filter` so we don't
// thrash on activity in workspaces the user can't see anyway.

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
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  return null;
}
