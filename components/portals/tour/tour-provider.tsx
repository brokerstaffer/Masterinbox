"use client";

import { useEffect } from "react";
import { useTourStore } from "@/lib/tour/store";
import { TourStep } from "@/components/portals/tour/tour-step";

// Drives the portal product tour. Mounted by PortalShell only when
// the `portal_tour` feature flag is on for this client.
//
// Behaviour:
//  - On first mount in a given browser (per token), schedule an
//    auto-start 300ms after mount so the sidebar has time to paint.
//    Subsequent visits skip auto-start (localStorage flag).
//  - Renders the current step's TourStep bubble. When the user hits
//    "Got it!" on the last step, write the completion flag.
//  - "Show me later" / X-button = skip. Skip ALSO writes the flag so
//    a dismissed tour doesn't return next visit.
//  - The replay button (TakeTheTourButton) calls store.start()
//    directly; that path bypasses the localStorage check.

type Step = {
  targetId: string;
  title: string;
  description: string;
  side?: "right" | "bottom";
};

function buildSteps(idealAgentProfileEnabled: boolean): Step[] {
  // Order mirrors the visual sidebar order so the tour reads top-to-bottom.
  const steps: Step[] = [
    {
      targetId: "pipeline",
      title: "Recruiting Pipeline",
      description:
        "Every introduction we make appears here. Move agents through each stage as you connect, interview, and hire.",
    },
    {
      targetId: "agents",
      title: "Your Agents",
      description:
        "Add your brokerage's own agents — we never reach out to anyone on this list.",
    },
    {
      targetId: "dnc",
      title: "DNC List",
      description:
        "Add Agents and companies we should never reach out to.",
    },
    {
      targetId: "team",
      title: "Team",
      description:
        "Manage who at your office receives introductions.",
    },
  ];
  if (idealAgentProfileEnabled) {
    steps.push({
      targetId: "ideal-agent-profile",
      title: "Ideal Agent Profile",
      description:
        "Tell us exactly what kind of agent you're looking for (Including sales volume, target markets, MLS affiliations, experience, and more). We'll use these filters to find agents that fit your needs.",
    });
  }
  return steps;
}

export function TourProvider({
  token,
  idealAgentProfileEnabled,
}: {
  token: string;
  // When the Ideal Agent Profile nav item isn't rendered for this
  // client, the tour drops that step rather than pointing at nothing.
  idealAgentProfileEnabled: boolean;
}) {
  const active = useTourStore((s) => s.active);
  const step = useTourStore((s) => s.step);
  const start = useTourStore((s) => s.start);
  const next = useTourStore((s) => s.next);
  const skip = useTourStore((s) => s.skip);
  const setTotalSteps = useTourStore((s) => s.setTotalSteps);

  const steps = buildSteps(idealAgentProfileEnabled);
  const totalSteps = steps.length;

  const completedKey = `portal:${token}:tour-completed-v1`;

  // Push step count into the store so next() knows when to finish.
  useEffect(() => {
    setTotalSteps(totalSteps);
  }, [setTotalSteps, totalSteps]);

  // Auto-start on first visit. localStorage gate prevents re-firing
  // after dismissal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(completedKey)) return;
    const t = window.setTimeout(() => start(), 300);
    return () => window.clearTimeout(t);
  }, [completedKey, start]);

  // Wrap next/skip so the very end (and explicit skip) writes the
  // completion marker.
  function handlePrimary() {
    if (step + 1 >= totalSteps) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(completedKey, "1");
      }
    }
    next();
  }
  function handleSkip() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(completedKey, "1");
    }
    skip();
  }

  if (!active) return null;
  const current = steps[step];
  if (!current) return null;
  const isLast = step + 1 >= totalSteps;

  return (
    <TourStep
      key={current.targetId}
      targetId={current.targetId}
      stepNumber={step + 1}
      totalSteps={totalSteps}
      title={current.title}
      description={current.description}
      primaryLabel={isLast ? "Got it!" : "Next"}
      side={current.side ?? "right"}
      onPrimary={handlePrimary}
      onSkip={handleSkip}
    />
  );
}
