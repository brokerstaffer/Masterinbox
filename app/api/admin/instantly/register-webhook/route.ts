import { NextResponse } from "next/server";
import { createInstantlyClient } from "@/lib/instantly/client";
import { RELEVANT_EVENTS } from "@/lib/instantly/types";
import { env } from "@/lib/env";

// One-shot admin endpoint: register (or refresh) our Instantly webhook so
// reply_received events start flowing into /api/webhooks/instantly.
//
// Idempotent: lists existing webhooks, deletes any that point at our URL,
// then creates a fresh one with the desired event types. Run after the
// app is first deployed and any time INSTANTLY_WEBHOOK_SECRET changes.
//
// Auth: same bootstrap-secret pattern as /api/webhooks/register —
// POST with `?token=<service-role-key>` (or set WEBHOOK_REGISTER_SECRET).

export const dynamic = "force-dynamic";

const DEFAULT_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WEBHOOK_REGISTER_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supplied = url.searchParams.get("token") ?? request.headers.get("x-register-token");
  if (!expected || supplied !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    base_url?: string;
    campaign_ids?: string[];
  };
  const base = (body.base_url ?? DEFAULT_BASE).replace(/\/$/, "");

  // Webhook receiver URL. Append the shared secret as `?token=` so we can
  // verify deliveries match what we registered (Instantly does not sign
  // payloads itself — this is the only thing standing between us and a
  // spoofed POST).
  const secret = env.INSTANTLY_WEBHOOK_SECRET;
  const targetUrl = secret
    ? `${base}/api/webhooks/instantly?token=${encodeURIComponent(secret)}`
    : `${base}/api/webhooks/instantly`;

  let instantly;
  try {
    instantly = createInstantlyClient();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Instantly not configured" },
      { status: 400 },
    );
  }

  // Remove every existing webhook pointing at our endpoint. Match on the URL
  // PATH (not query string) so rotating the secret doesn't leave orphans.
  let deleted = 0;
  try {
    const existing = await instantly.listWebhooks();
    const items = existing.items ?? [];
    for (const hook of items) {
      const hookUrl = hook.webhook_url ?? "";
      if (hookUrl.startsWith(`${base}/api/webhooks/instantly`)) {
        try {
          await instantly.deleteWebhook(hook.id);
          deleted += 1;
        } catch (err) {
          console.error("[instantly] failed to delete stale webhook", hook.id, err);
        }
      }
    }
  } catch (err) {
    console.error("[instantly] listWebhooks failed", err);
  }

  let created;
  try {
    created = await instantly.createWebhook({
      name: "Corofy Master Inbox",
      webhook_url: targetUrl,
      event_types: RELEVANT_EVENTS,
      campaign_ids: body.campaign_ids,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "createWebhook failed",
        target_url: targetUrl,
        deleted,
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      target_url: targetUrl,
      webhook_id: created.id,
      event_types: created.event_types,
      campaign_ids: created.campaign_ids ?? [],
      deleted_stale: deleted,
    },
    { status: 200 },
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "POST with ?token=<service-role-key> to register the Instantly webhook.",
    target_url: `${DEFAULT_BASE}/api/webhooks/instantly`,
    events: RELEVANT_EVENTS,
  });
}
