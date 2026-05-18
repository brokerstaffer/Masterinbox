import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createUnipileClient } from "@/lib/unipile/client";
import { env } from "@/lib/env";

// Returns a Unipile-hosted auth URL the user can open to connect a
// LinkedIn account. Once they complete the flow, Unipile pushes an
// account_connected webhook + the account appears in /accounts. Run
// /api/admin/unipile/sync afterwards to import it as a channel.

export const dynamic = "force-dynamic";

export async function POST() {
  await requireSession();

  let unipile;
  try {
    unipile = createUnipileClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unipile not configured" },
      { status: 400 },
    );
  }

  // DSN is the Unipile API URL — strip the path back to host:port.
  const dsnHost = (env.UNIPILE_DSN ?? "").replace(/^https?:\/\//, "");
  const apiUrl = `https://${dsnHost}`;
  const appUrl = env.APP_URL.replace(/\/$/, "");
  // Expire link 30 minutes from now.
  const expiresOn = new Date(Date.now() + 30 * 60_000).toISOString();

  try {
    const result = await unipile.createHostedAuthLink({
      type: "create",
      providers: "LINKEDIN",
      api_url: apiUrl,
      expiresOn,
      success_redirect_url: `${appUrl}/settings/channels?unipile=success`,
      failure_redirect_url: `${appUrl}/settings/channels?unipile=failure`,
      notify_url: `${appUrl}/api/webhooks/unipile`,
    });
    return NextResponse.json({ url: result.url, expires_on: expiresOn });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "createHostedAuthLink failed" },
      { status: 502 },
    );
  }
}
