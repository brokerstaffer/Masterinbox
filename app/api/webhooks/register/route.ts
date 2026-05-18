import { NextResponse } from "next/server";
import { createEmailBisonClient } from "@/lib/emailbison/client";
import { createUnipileClient } from "@/lib/unipile/client";
import { RELEVANT_EVENTS } from "@/lib/emailbison/types";

// Registers (or replaces) webhook URLs with EmailBison and Unipile so they
// start pushing events into our app.
//
// EmailBison is multi-workspace ("team") — webhooks are scoped per team, so we
// iterate every team the API key can see, switch context, then upsert the
// webhook URL there. Unipile is global (single account), one webhook.
//
// Idempotent: list existing webhooks, delete any pointing at our URL, create
// fresh ones.
//
// Auth: callable only with our internal bootstrap secret. POST with `?token=...`.
// Falls back to SUPABASE_SERVICE_ROLE_KEY if WEBHOOK_REGISTER_SECRET isn't set.

export const dynamic = "force-dynamic";

const DEFAULT_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WEBHOOK_REGISTER_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supplied = url.searchParams.get("token") ?? request.headers.get("x-register-token");
  if (!expected || supplied !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { base_url?: string };
  const base = (body.base_url ?? DEFAULT_BASE).replace(/\/$/, "");
  const ebUrl = `${base}/api/webhooks/emailbison`;
  const upUrl = `${base}/api/webhooks/unipile`;

  const emailbisonResults: Array<{
    workspace_id: number;
    workspace_name: string;
    ok: boolean;
    webhook_id?: number;
    error?: string;
  }> = [];

  // ---- EmailBison: register in every workspace ----
  try {
    const eb = createEmailBisonClient();
    const workspaces = await eb.listWorkspaces();
    for (const ws of workspaces.data ?? []) {
      try {
        await eb.switchWorkspace(ws.id);
        const existing = await eb.listWebhooks();
        for (const hook of existing.data ?? []) {
          if (hook.url === ebUrl) {
            await eb.deleteWebhook(hook.id).catch(() => undefined);
          }
        }
        const created = await eb.createWebhook({
          name: "Corofy Master Inbox",
          url: ebUrl,
          events: RELEVANT_EVENTS,
        });
        emailbisonResults.push({
          workspace_id: ws.id,
          workspace_name: ws.name,
          ok: true,
          webhook_id: created.data?.id,
        });
      } catch (err) {
        emailbisonResults.push({
          workspace_id: ws.id,
          workspace_name: ws.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    emailbisonResults.push({
      workspace_id: 0,
      workspace_name: "<listWorkspaces failed>",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- Unipile: single webhook ----
  let unipileResult: { ok: boolean; webhook_id?: string; url: string; error?: string };
  try {
    const up = createUnipileClient();
    const existing = await up.listWebhooks().catch(() => ({ items: [] as unknown[] }));
    for (const hook of existing.items ?? []) {
      const h = hook as { id?: string; request_url?: string };
      if (h.request_url === upUrl && h.id) {
        await up.deleteWebhook(h.id).catch(() => undefined);
      }
    }
    const created = await up.createWebhook({
      source: "messaging",
      request_url: upUrl,
      name: "Corofy Master Inbox",
    });
    unipileResult = { ok: true, webhook_id: created.id, url: upUrl };
  } catch (err) {
    unipileResult = {
      ok: false,
      url: upUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const okCount = emailbisonResults.filter((r) => r.ok).length;
  return NextResponse.json(
    {
      ok: true,
      summary: {
        emailbison_workspaces_registered: okCount,
        emailbison_workspaces_total: emailbisonResults.length,
        unipile_registered: unipileResult.ok,
      },
      target_urls: { emailbison: ebUrl, unipile: upUrl },
      emailbison: emailbisonResults,
      unipile: unipileResult,
    },
    { status: 200 },
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "POST here with ?token=<service-role-key> to register webhook URLs in every EmailBison workspace and once in Unipile.",
    target_urls: {
      emailbison: `${DEFAULT_BASE}/api/webhooks/emailbison`,
      unipile: `${DEFAULT_BASE}/api/webhooks/unipile`,
    },
  });
}
