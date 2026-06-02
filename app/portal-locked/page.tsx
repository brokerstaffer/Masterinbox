import type { Metadata } from "next";
import { PortalLogo } from "@/components/portals/portal-logo";

// Branded fail-closed page served on portal.brokerstaffer.com for
// every path that isn't a portal-token route. Replaces the previous
// 302-to-Railway behaviour, which was exposing /inbox to anyone who
// landed on the subdomain root.

export const metadata: Metadata = {
  title: "BrokerStaffer Client Portal",
  robots: { index: false, follow: false },
};

export default function PortalLocked() {
  return (
    <div className="min-h-screen bg-[#f4f7fb] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <PortalLogo className="mx-auto h-10 w-auto" />
        <h1 className="mt-5 text-lg font-semibold text-[#15181e]">
          Portal link required
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[#5b6370]">
          Your unique portal address looks like
          {" "}
          <code className="rounded bg-[#eaf2fd] px-1 py-0.5 text-[12px] text-[#1565C0]">
            portal.brokerstaffer.com/portal/&lt;your-id&gt;
          </code>
          {" "}
          and was emailed to you by BrokerStaffer. Please use that link.
        </p>
      </div>
    </div>
  );
}
