"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps the public client portal live. The portal page is a server
// component, so a plain interval calling router.refresh() re-runs the
// server render and pulls fresh Introduction data — within INTERVAL_MS of
// a lead being labeled in MasterInbox.
//
// Polling (not Supabase Realtime) is deliberate: the portal has no
// authenticated user, and wiring Realtime would mean loosening RLS on
// label_assignments for anon. A 30s poll is cheap and leaks nothing.
const INTERVAL_MS = 30_000;

export function PortalRefresher() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      // Pause while the tab is backgrounded — no point refreshing a
      // portal nobody is looking at.
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
