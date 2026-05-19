"use client";

import { createContext, useContext } from "react";
import type { ThreadRow } from "@/lib/inbox/threads";
import type { LabelRow } from "@/lib/inbox/labels-shared";

// Inbox-wide data hoisted into the [view]/layout.tsx and read via context
// from any descendant client component. Avoids re-fetching the same
// workspace-wide rows on every per-thread navigation.
export interface InboxContextValue {
  workspaceId: string;
  basePath: string;             // "/inbox/<view>"
  threads: ThreadRow[];
  labels: LabelRow[];
}

const InboxContext = createContext<InboxContextValue | null>(null);

export function InboxProvider({
  value,
  children,
}: {
  value: InboxContextValue;
  children: React.ReactNode;
}) {
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInboxContext(): InboxContextValue {
  const ctx = useContext(InboxContext);
  if (!ctx) {
    throw new Error(
      "useInboxContext must be used inside an InboxProvider (mounted in app/(app)/inbox/[view]/layout.tsx).",
    );
  }
  return ctx;
}

// Returns null when used outside the InboxProvider — handy for shared
// components that need to gracefully fall back when rendered from
// other routes (e.g. settings preview, reminders page, etc).
export function useInboxContextOptional(): InboxContextValue | null {
  return useContext(InboxContext);
}
