import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Ban,
  CalendarClock,
  UserCheck,
  Users,
  Workflow,
} from "lucide-react";
import { resolvePortalClient } from "@/lib/portals/token";
import { loadPortalCounts } from "@/lib/portals/portal-data";
import { PortalLogo } from "@/components/portals/portal-logo";

// First-impression landing page for the Client Portal.
//
// First-visit-per-session redirect from /portal/[token] sends the
// brokerage here; afterwards the "Welcome" item in the sidebar
// brings them back any time. Single-column, max-w-4xl, soft blue
// glow on the hero — same design language as the rest of the portal
// but a touch warmer for the greeting.

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Welcome` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

const CALENDLY_URL = "https://calendly.com/brokerstaffer/touchbase";

export default async function WelcomePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();
  const counts = await loadPortalCounts(client.id);

  const base = `/portal/${token}`;

  const sections: Section[] = [
    {
      href: base,
      icon: Workflow,
      title: "Recruiting Pipeline",
      description:
        "Track every introduced candidate from first reply to placement.",
      count: counts.pipeline,
      countLabel: "candidates",
    },
    {
      href: `${base}/agents`,
      icon: UserCheck,
      title: "Your Agents",
      description:
        "The agents we're targeting on your behalf — fully editable.",
      count: counts.agents,
      countLabel: "agents",
    },
    {
      href: `${base}/dnc`,
      icon: Ban,
      title: "Do Not Contact",
      description: "Names, emails, and domains we'll never reach out to.",
      count: counts.dnc,
      countLabel: "entries",
      tone: "danger",
    },
    {
      href: `${base}/team`,
      icon: Users,
      title: "Team",
      description:
        "Who at your firm receives introductions and digests from us.",
      count: counts.team,
      countLabel: "members",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      {/* Hero card — soft radial blue glow on white, large greeting,
          portal logo top-right. */}
      <section className="relative overflow-hidden rounded-3xl border border-[#ebecf0] bg-white p-6 shadow-sm sm:p-9">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[#eaf2fd] opacity-70 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-72 rounded-full bg-[#f0e9fc] opacity-60 blur-3xl"
        />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1565C0]">
              Welcome
            </div>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-[#0f1320] sm:text-[32px]">
              Hi {client.name}, your recruiting hub is ready.
            </h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[#5b6472] sm:text-[14px]">
              Your pipeline, the agents we&apos;re prospecting on your behalf,
              the DNC list, and your team, all in one place. We&apos;ll keep
              everything in sync. You stay in the driver&apos;s seat.
            </p>
          </div>
          <PortalLogo className="hidden h-9 w-auto shrink-0 opacity-80 sm:block" />
        </div>

        {/* Quick-stat strip — three small tiles inside the hero. */}
        <div className="relative mt-7 grid grid-cols-3 gap-3">
          <Stat label="Candidates" value={counts.pipeline} />
          <Stat label="Active agents" value={counts.agents} />
          <Stat label="Team members" value={counts.team} />
        </div>
      </section>

      {/* Section cards. 2-col on desktop, stacked on mobile. */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-4">
        {sections.map((s) => (
          <SectionCard key={s.href} section={s} />
        ))}
      </section>

      {/* Calendly call-to-action — soft blue card with a single
          button. Mirrors the bottom CTA cards used elsewhere in the
          portal. */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-[#bcd5f1] bg-gradient-to-br from-[#eaf2fd] via-white to-[#eaf2fd] p-5 shadow-sm sm:mt-8 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#1565C0] text-white shadow-sm">
              <CalendarClock className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold text-[#0f1320]">
                Want to chat? Book a touch-base.
              </div>
              <p className="text-[12.5px] leading-snug text-[#5b6472]">
                15 minutes with our team. We&apos;ll walk through anything
                you need on your pipeline.
              </p>
            </div>
          </div>
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[#1565C0] px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#10499a]"
          >
            Schedule a call
            <ArrowRight className="size-4" />
          </a>
        </div>
      </section>
    </div>
  );
}

type Section = {
  href: string;
  icon: typeof Workflow;
  title: string;
  description: string;
  count: number;
  countLabel: string;
  tone?: "danger";
};

function SectionCard({ section }: { section: Section }) {
  const Icon = section.icon;
  return (
    <Link
      href={section.href}
      className="group relative flex flex-col gap-3 rounded-2xl border border-[#ebecf0] bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#bcd5f1] hover:shadow-md sm:p-6"
    >
      <div className="flex items-center justify-between">
        <div
          className={
            section.tone === "danger"
              ? "flex size-10 items-center justify-center rounded-xl bg-[#fee2e2] text-[#b91c1c]"
              : "flex size-10 items-center justify-center rounded-xl bg-[#eaf2fd] text-[#1565C0]"
          }
        >
          <Icon className="size-[18px]" />
        </div>
        <span
          className={
            section.tone === "danger"
              ? "inline-flex items-center gap-1 rounded-full bg-[#fee2e2] px-2.5 py-1 text-[11.5px] font-semibold text-[#b91c1c]"
              : "inline-flex items-center gap-1 rounded-full bg-[#f5f7fa] px-2.5 py-1 text-[11.5px] font-semibold text-[#5b6472]"
          }
        >
          <span className="tabular-nums">{section.count.toLocaleString()}</span>
          <span className="text-[11px] font-medium opacity-80">
            {section.countLabel}
          </span>
        </span>
      </div>
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-[#0f1320]">
          {section.title}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#5b6472]">
          {section.description}
        </p>
      </div>
      <div className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#1565C0]">
        Open
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#ebecf0] bg-white/70 px-3 py-2.5 backdrop-blur-sm">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#9aa0ab]">
        {label}
      </div>
      <div className="mt-0.5 text-[20px] font-semibold tabular-nums text-[#0f1320]">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
