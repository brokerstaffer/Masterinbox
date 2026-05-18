import { NextResponse } from "next/server";
import { handleUnipileEvent } from "@/lib/sync/unipile";
import type { UnipileWebhookEvent } from "@/lib/unipile/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.UNIPILE_WEBHOOK_SECRET;
  if (expected) {
    const supplied = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
    if (supplied !== expected) {
      return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
    }
  }

  let event: UnipileWebhookEvent;
  try {
    event = (await request.json()) as UnipileWebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await handleUnipileEvent(event);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[unipile webhook] handler error", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 200 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    receiver: "unipile",
    expects_secret: Boolean(process.env.UNIPILE_WEBHOOK_SECRET),
  });
}
