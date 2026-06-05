"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// First-visit-per-session redirect from /portal/[token] → /welcome.
// Stamped in sessionStorage so returning visits in the same tab go
// straight to the Pipeline (where the brokerage spends most of
// their time). Closing the browser and reopening it surfaces the
// welcome again, which is the right cadence for a once-in-a-while
// re-introduction.
export function WelcomeRedirect({ token }: { token: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      const key = `portal-welcomed-${token}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      router.replace(`/portal/${token}/welcome`);
    } catch {
      // sessionStorage can be blocked (e.g. private mode in some
      // browsers). Silently skip — the user can still reach the
      // welcome page from the sidebar.
    }
  }, [router, token]);
  return null;
}
