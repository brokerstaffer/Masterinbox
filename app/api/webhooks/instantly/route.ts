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
      return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
    }
  }

  let envelope: InstantlyWebhookEnvelope;
  try {
    envelope = (await request.json()) as InstantlyWebhookEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Log the full envelope while we settle on the canonical Instantly delivery
  // shape. The docs show one schema; the live API has shown small differences
  // before. Remove this log once a few real reply_received events have been
  // captured and the types in lib/instantly/types.ts are confirmed.
  console.log("[instantly webhook] envelope:", JSON.stringify(envelope));

  try {
    const result = await handleInstantlyEvent(envelope);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[instantly webhook] handler error", err);
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
