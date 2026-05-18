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
      const hookUrl = hook.target_hook_url ?? "";
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

  // Instantly is one webhook per event type — POST per event in RELEVANT_EVENTS.
  const created: Array<{ id: string; event_type: string }> = [];
  const errors: Array<{ event_type: string; error: string }> = [];
  for (const ev of RELEVANT_EVENTS) {
    try {
      const c = await instantly.createWebhook({
        name: `Corofy Master Inbox — ${ev}`,
        target_hook_url: targetUrl,
        event_type: ev,
      });
      created.push({ id: c.id, event_type: c.event_type });
    } catch (err) {
      errors.push({
        event_type: ev,
        error: err instanceof Error ? err.message : "createWebhook failed",
      });
    }
  }

  if (created.length === 0 && errors.length > 0) {
    return NextResponse.json(
      { ok: false, errors, target_url: targetUrl, deleted_stale: deleted },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      target_url: targetUrl,
      created,
      errors,
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
