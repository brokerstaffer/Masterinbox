"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One tour bubble. Finds its anchor element by `data-tour-target`,
// reads its bounding rect, renders a fixed-position card next to
// it (defaults to the right side, since the portal's sidebar lives
// on the left).

export type TourStepProps = {
  targetId: string;
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
  // "Next" vs "Got it!" for the final step.
  primaryLabel: string;
  // Optional left/right preferred side; "right" by default works for
  // sidebar items.
  side?: "right" | "bottom";
  onPrimary: () => void;
  onSkip: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

export function TourStep({
  targetId,
  stepNumber,
  totalSteps,
  title,
  description,
  primaryLabel,
  side = "right",
  onPrimary,
  onSkip,
}: TourStepProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mount flag so createPortal only fires on the client.
  useEffect(() => setMounted(true), []);

  // Measure the anchor on mount + whenever the target changes; also
  // re-measure on resize / scroll so the bubble tracks the anchor.
  useLayoutEffect(() => {
    let raf = 0;
    function measure() {
      const el = document.querySelector<HTMLElement>(
        `[data-tour-target="${targetId}"]`,
      );
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    }
    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    }
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [targetId]);

  if (!mounted) return null;
  if (!rect) return null;

  const GAP = 12;
  const BUBBLE_W = 320;
  const top =
    side === "right"
      ? Math.max(8, rect.top - 4)
      : rect.top + rect.height + GAP;
  const left =
    side === "right"
      ? Math.min(
          window.innerWidth - BUBBLE_W - 8,
          rect.left + rect.width + GAP,
        )
      : Math.max(
          8,
          Math.min(
            window.innerWidth - BUBBLE_W - 8,
            rect.left + rect.width / 2 - BUBBLE_W / 2,
          ),
        );

  return createPortal(
    <>
      {/* Highlight ring around the anchor. pointer-events-none so it
          doesn't block clicks on the underlying nav item. */}
      <div
        className="pointer-events-none fixed z-40 rounded-md ring-2 ring-[#1565C0] ring-offset-2 ring-offset-background transition-all duration-150"
        style={{
          top: rect.top - 2,
          left: rect.left - 2,
          width: rect.width + 4,
          height: rect.height + 4,
        }}
      />

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={`tour-step-title-${stepNumber}`}
        className={cn(
          "fixed z-50 w-80 rounded-lg bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10",
          "animate-in fade-in-0 zoom-in-95 duration-150",
        )}
        style={{ top, left }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Step {stepNumber} of {totalSteps}
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close tour"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <h3
          id={`tour-step-title-${stepNumber}`}
          className="mt-1 text-sm font-semibold"
        >
          {title}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSkip}
          >
            Show me later
          </Button>
          <Button type="button" size="sm" onClick={onPrimary}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
