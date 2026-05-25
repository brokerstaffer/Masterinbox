"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PortalLogo } from "@/components/portals/portal-logo";

// Shared UI primitives for the portal surfaces (Pipeline, Agents, DNC,
// Team). Keep the look consistent with the existing portal — light card
// surface, refined typography, no flashy effects.

export function PortalPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[#5b6472]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// A subtle mount fade-in for tables — same useMounted() pattern used in
// the chart redesign. No loop, no bounce.
export function useMounted(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

export function PortalEmpty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#dde0e5] bg-white p-12 text-center">
      <PortalLogo className="mx-auto size-10 opacity-60" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-xs text-[#9aa0ab]">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

// One pill style used across status badges. Tones: neutral, success,
// warning, danger, accent.
export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[#eef0f3] text-[#5b6472]",
    success: "bg-[#e9f7ef] text-[#0c8a4e]",
    warning: "bg-[#fef7e6] text-[#a06200]",
    danger: "bg-[#fee2e2] text-[#b91c1c]",
    accent: "bg-[#eaf2fd] text-[#1565C0]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// Initials avatar — used in the Team and DNC lists.
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eaf2fd] text-xs font-semibold text-[#1565C0]",
        className,
      )}
    >
      {initials}
    </div>
  );
}
