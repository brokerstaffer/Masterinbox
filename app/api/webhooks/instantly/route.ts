import { NextResponse } from "next/server";
import { handleInstantlyEvent } from "@/lib/sync/instantly";
import type { InstantlyWebhookEnvelope } from "@/lib/instantly/types";

// Instantly.ai webhook receiver. Same contract as the EmailBison one:
// ack with 200 even on processing errors so the provider doesn't keep
// retrying — failures land in logs and the audit_log.
//
// Auth: Instantly does NOT publish a webhook secret / HMAC signature.
// We require an optional shared-secret query parameter `?token=...`
// checked against INSTANTLY_WEBHOOK_SECRET. The token is set when
// registering the webhook (lib/instantly/register-webhook flow).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.INSTANTLY_WEBHOOK_SECRET;
  if (expected) {
    const supplied = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
    if (supplied !== expected) {
      console.warn("[instantly drop]", JSON.stringify({ reason: "invalid token at edge" }));
      return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
    }
  }

  let envelope: InstantlyWebhookEnvelope;
  try {
    envelope = (await request.json()) as InstantlyWebhookEnvelope;
  } catch {
    console.warn("[instantly drop]", JSON.stringify({ reason: "invalid json at edge" }));
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Full envelope dump kept around — lets us reconstruct any drop from log
  // grep alone without needing to replay the request.
  console.log("[instantly webhook] envelope:", JSON.stringify(envelope));

  try {
    const result = await handleInstantlyEvent(envelope);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.warn(
      "[instantly drop]",
      JSON.stringify({
        reason: "handler threw",
        email_id: envelope.email_id ?? null,
        lead: envelope.lead_email ?? envelope.email ?? null,
        campaign_id: envelope.campaign_id ?? null,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 200 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    receiver: "instantly",
    expects_secret: Boolean(process.env.INSTANTLY_WEBHOOK_SECRET),
  });
}
