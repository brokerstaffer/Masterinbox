"use client";

import { Compass } from "lucide-react";
import { useTourStore } from "@/lib/tour/store";

// "Take the tour" replay button. Sits in the portal sidebar so an
// operator can re-run the walkthrough on demand (handy for client
// demos). Rendered only when the portal_tour feature flag is on.

export function TakeTheTourButton() {
  const start = useTourStore((s) => s.start);
  return (
    <button
      type="button"
      onClick={() => start()}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Compass className="size-3.5" />
      Take the tour
    </button>
  );
}
