"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Catches rendering errors inside (app)/ so the user sees something useful
// instead of "This page couldn't load". Logs to the browser console for
// inspection.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="max-w-md w-full rounded-xl border bg-card p-6 shadow-sm space-y-3">
        <h1 className="text-base font-semibold">Something broke</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Reference: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={() => reset()}>Try again</Button>
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/inbox")}>
            Go to inbox
          </Button>
        </div>
      </div>
    </div>
  );
}
