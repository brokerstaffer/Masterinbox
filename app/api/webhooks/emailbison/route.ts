import { NextResponse } from "next/server";
import { handleEmailBisonEvent } from "@/lib/sync/emailbison";
import type { EmailBisonWebhookEnvelope } from "@/lib/emailbison/types";

// EmailBison webhook receiver. Returns 200 fast even on processing errors so the
// provider doesn't keep retrying — we'll surface failures via the audit_log and
// internal alerts. If we ever switch to BullMQ background processing, this
// endpoint should just enqueue + 200.
//
// Auth: EmailBison doesn't currently sign webhooks. We accept an optional
// shared-secret query parameter `?token=...` checked against EMAILBISON_WEBHOOK_SECRET.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.EMAILBISON_WEBHOOK_SECRET;
  if (expected) {
    const supplied = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
    if (supplied !== expected) {
      return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
    }
  }

  let envelope: EmailBisonWebhookEnvelope;
  try {
    envelope = (await request.json()) as EmailBisonWebhookEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Log the full envelope so we can inspect actual EmailBison delivery shape
  // (sender_email field, custom_variables, anything else missing from our
  // typed handlers). Keep until we're confident extraction is correct.
  console.log("[emailbison webhook] envelope:", JSON.stringify(envelope));

  try {
    const result = await handleEmailBisonEvent(envelope);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[emailbison webhook] handler error", err);
    // 200 so provider doesn't retry. Failures land in logs.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 200 },
    );
  }
}

// Useful for quick reachability checks.
export async function GET() {
  return NextResponse.json({
    ok: true,
    receiver: "emailbison",
    expects_secret: Boolean(process.env.EMAILBISON_WEBHOOK_SECRET),
  });
}
