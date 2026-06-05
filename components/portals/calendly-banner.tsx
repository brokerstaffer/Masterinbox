"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarClock, X, ArrowRight } from "lucide-react";

// Slim top banner across every portal page (except /welcome, which
// already has its own Calendly CTA in its hero — a double-CTA would
// be visual noise). Dismissible per-session via localStorage so a
// user who closes it once doesn't see it on every reload.
//
// Solid portal blue (#1565C0) with white text — the same accent
// used for active sidebar links, so it reads as part of the portal
// shell rather than a marketing intrusion.

const CALENDLY_URL = "https://calendly.com/brokerstaffer/touchbase";
const DISMISS_KEY = "portal-banner-dismissed-v1";

export function CalendlyBanner() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(DISMISS_KEY)) setDismissed(true);
    } catch {
      // ignore
    }
  }, []);

  // Hide on the welcome page — it has its own Calendly CTA.
  const onWelcome = !!pathname && /\/portal\/[^/]+\/welcome(?:\/?$)/.test(pathname);
  const visible = mounted && !dismissed && !onWelcome;

  // Expose the banner height as a CSS variable on <html> so the
  // portal shell can offset the sticky sidebar + mobile header
  // without having to know the banner's dismissed state directly.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) {
      root.style.setProperty("--portal-banner-h", "2.5rem");
    } else {
      root.style.removeProperty("--portal-banner-h");
    }
    return () => {
      root.style.removeProperty("--portal-banner-h");
    };
  }, [visible]);

  if (!visible) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-10 bg-[#1565C0] text-white shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {/* Centered message lives in normal flow; the dismiss button
          is absolutely positioned so it can't pull the text off
          center the way a justify-between layout does. */}
      <div className="relative flex h-full items-center justify-center px-12 sm:px-14">
        <div className="flex min-w-0 items-center gap-2.5">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          <p className="truncate text-[12.5px] leading-none">
            <span className="hidden sm:inline">
              Need help or have questions?{" "}
            </span>
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
            >
              <span className="hidden sm:inline">Book a touch-base with our team</span>
              <span className="sm:hidden">Book a touch-base</span>
              <ArrowRight className="size-3.5" aria-hidden />
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss banner"
          className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:right-3"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
