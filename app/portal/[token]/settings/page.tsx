import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Settings2 } from "lucide-react";
import { resolvePortalClient } from "@/lib/portals/token";
import { FollowUpBossSettings } from "@/components/portals/followup-boss-settings";

// Per-client portal Settings page. Today it hosts the Follow Up Boss
// connection card; future integrations (Salesforce, Brivity, etc.)
// drop in here as additional <section>s.

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  return {
    title: client ? `${client.name} — Settings` : "Portal not found",
    robots: { index: false, follow: false },
  };
}

export default async function SettingsPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const client = await resolvePortalClient(token);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-start gap-3 sm:mb-8">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf2fd] text-[#1565C0]">
          <Settings2 className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1565C0]">
            Settings
          </div>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-[#0f1320] sm:text-[28px]">
            Connect your tools
          </h1>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-[#5b6472]">
            Wire BrokerStaffer into the CRM your team already uses, so every
            warm introduction lands in the right place automatically.
          </p>
        </div>
      </header>

      <FollowUpBossSettings
        token={token}
        connected={client.fub_api_key_set}
        connectedAt={client.fub_connected_at}
      />
    </div>
  );
}
