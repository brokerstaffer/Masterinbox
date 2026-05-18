import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createUnipileClient } from "@/lib/unipile/client";
import { env } from "@/lib/env";

// Pulls existing Unipile accounts and registers/refreshes the workspace's
// webhook subscription against our /api/webhooks/unipile receiver. Idempotent.
//
// Run this once you've connected a LinkedIn account on Unipile's side
// (either via their dashboard or our /admin/unipile/connect hosted-auth
// flow). Channels rows get created for each account so messages can be
// associated to a workspace by unipile_account_id.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await requireSession();
  const wsId = session.activeWorkspace.id;
  const admin = createAdminSupabase();

  let unipile;
  try {
    unipile = createUnipileClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unipile not configured" },
      { status: 400 },
    );
  }

  // 1. Pull connected accounts from Unipile.
  let accounts: Array<{ id: string; type: string; name?: string; status?: string }> = [];
  try {
    const res = await unipile.listAccounts();
    accounts = res.items ?? [];
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "listAccounts failed" },
      { status: 502 },
    );
  }

  // 2. Upsert a channel for each LinkedIn-flavoured account. We only
  // recognise types that map to a chat channel — Unipile also returns
  // mail/sms/imap accounts that aren't relevant here.
  const linkedinTypes = new Set([
    "LINKEDIN",
    "linkedin",
    "MESSENGER",
    "INSTAGRAM",
    "WHATSAPP",
    "X",
    "TELEGRAM",
  ]);
  let channelsCreated = 0;
  let channelsUpdated = 0;
  for (const a of accounts) {
    if (!linkedinTypes.has(a.type)) continue;
    const { data: existing } = await admin
      .from("channels")
      .select("id")
      .eq("workspace_id", wsId)
      .eq("provider", "unipile")
      .eq("unipile_account_id", a.id)
      .maybeSingle();
    const display = a.name ?? `${a.type} account`;
    const status = (a.status ?? "connected").toLowerCase();
    if (existing) {
      await admin
        .from("channels")
        .update({
          display_name: display,
          status: status === "connected" ? "connected" : "disconnected",
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      channelsUpdated++;
    } else {
      await admin.from("channels").insert({
        workspace_id: wsId,
        type: "linkedin",
        provider: "unipile",
        display_name: display,
        unipile_account_id: a.id,
        status: "connected",
        last_synced_at: new Date().toISOString(),
      });
      channelsCreated++;
    }
  }

  // 3. Make sure our webhook is registered with Unipile. List + dedupe
  // by request_url so we don't accumulate duplicates on every sync.
  const appUrl = env.APP_URL.replace(/\/$/, "");
  const targetUrl = `${appUrl}/api/webhooks/unipile`;
  let webhookId: string | null = null;
  let webhookCreated = false;
  try {
    const list = await unipile.listWebhooks();
    const items = (list.items ?? []) as Array<{ id: string; request_url?: string }>;
    const match = items.find((w) => w.request_url === targetUrl);
    if (match) {
      webhookId = match.id;
    } else {
      const created = await unipile.createWebhook({
        source: "messaging",
        request_url: targetUrl,
        events: ["message_received"],
        name: "corofy-master-inbox",
      });
      webhookId = created.id;
      webhookCreated = true;
    }
  } catch (err) {
    return NextResponse.json(
      {
        warning:
          "Channels synced but webhook registration failed: " +
          (err instanceof Error ? err.message : "unknown"),
        channels_created: channelsCreated,
        channels_updated: channelsUpdated,
        accounts_seen: accounts.length,
      },
      { status: 502 },
    );
  }

  // 4. Persist webhook subscription record.
  if (webhookId) {
    const { data: existingSub } = await admin
      .from("webhook_subscriptions")
      .select("id")
      .eq("workspace_id", wsId)
      .eq("provider", "unipile")
      .eq("target_url", targetUrl)
      .maybeSingle();
    if (existingSub) {
      await admin
        .from("webhook_subscriptions")
        .update({
          event_types: ["message_received"],
          status: "active",
          last_event_at: null,
        })
        .eq("id", existingSub.id);
    } else {
      await admin.from("webhook_subscriptions").insert({
        workspace_id: wsId,
        provider: "unipile",
        event_types: ["message_received"],
        target_url: targetUrl,
        status: "active",
      });
    }
  }

  return NextResponse.json({
    accounts_seen: accounts.length,
    channels_created: channelsCreated,
    channels_updated: channelsUpdated,
    webhook_id: webhookId,
    webhook_created: webhookCreated,
    webhook_url: targetUrl,
  });
}
