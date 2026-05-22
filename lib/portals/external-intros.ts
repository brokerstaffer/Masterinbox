import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { deriveClientIdFromCampaign } from "@/lib/clients/derive";
import type { IntroLead } from "@/lib/portals/intro-leads";

// Legacy MasterInbox Introduction feed.
//
// A separate MasterInbox deployment exposes its booked introductions at
// the URL below — but it takes ~30s to respond, far too slow to call on
// a portal render. So we mirror it into the `external_intros` table:
//
//   syncExternalIntros()        — the slow fetch + upsert. Runs off the
//                                 request path, driven by the cron at
//                                 POST /api/cron/sync-external-intros.
//   loadExternalIntrosByClient()— the fast read the portal uses. Hits
//                                 only our own Supabase table.
//
// The portal then folds this together with our own Introduction data —
// see loadCombinedClientIntroLeads in intro-leads.ts.

const EXTERNAL_INTROS_URL =
  "https://web-production-d18b09.up.railway.app/api/masterinbox/intros";

interface ExternalIntro {
  email?: string;
  name?: string;
  campaign_id?: string;
  campaign_name?: string;
  intro_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SyncResult {
  fetched: number; // rows the upstream returned
  upserted: number; // rows written to external_intros
  skipped: number; // rows dropped (missing email/campaign_id, or feed dupes)
  clientsMatched: number; // distinct clients the rows resolved to
}

// Pull the legacy feed and upsert it into external_intros. Slow (~30s
// upstream) — only ever called by the cron route, never on a render.
// Upsert is keyed on (email, campaign_id) so re-runs never duplicate.
export async function syncExternalIntros(): Promise<SyncResult> {
  const res = await fetch(EXTERNAL_INTROS_URL, {
    // Generous timeout — the upstream is genuinely ~30s. This runs in the
    // cron, off the request path, so the wait is fine.
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstream returned ${res.status}`);
  const json = (await res.json()) as { intros?: ExternalIntro[] };
  const intros = Array.isArray(json.intros) ? json.intros : [];

  // Resolve each DISTINCT campaign name to a client once.
  const campaignToClient = new Map<string, string | null>();
  for (const x of intros) {
    const name = x.campaign_name ?? "";
    if (campaignToClient.has(name)) continue;
    campaignToClient.set(name, await deriveClientIdFromCampaign(name || null));
  }

  // Build rows. Require email + campaign_id (the dedup key); drop feed
  // duplicates up front so the upsert payload is already clean.
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let skipped = 0;
  const now = new Date().toISOString();
  for (const x of intros) {
    const email = x.email?.trim().toLowerCase();
    const campaignId = x.campaign_id?.trim();
    if (!email || !campaignId) {
      skipped += 1;
      continue;
    }
    const key = `${email}|${campaignId}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    rows.push({
      email,
      name: x.name?.trim() || null,
      campaign_id: campaignId,
      campaign_name: x.campaign_name ?? null,
      client_id: campaignToClient.get(x.campaign_name ?? "") ?? null,
      intro_at: x.intro_at ?? x.created_at ?? null,
      source_created_at: x.created_at ?? null,
      source_updated_at: x.updated_at ?? null,
      synced_at: now,
    });
  }

  const admin = createAdminSupabase();
  let upserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await admin
      .from("external_intros")
      .upsert(slice, { onConflict: "email,campaign_id" });
    if (error) throw new Error(`external_intros upsert failed: ${error.message}`);
    upserted += slice.length;
  }

  const clientsMatched = new Set(
    rows.map((r) => r.client_id).filter((c): c is string => Boolean(c)),
  ).size;
  return { fetched: intros.length, upserted, skipped, clientsMatched };
}

// Every mirrored external intro grouped by client_id, shaped as IntroLead
// so it merges cleanly with our own data. Reads only the local table —
// fast. Wrapped in cache() so one render resolves it once. If the table
// doesn't exist yet (migration 0019 not run) this quietly returns empty
// and the portal just shows our own data.
export const loadExternalIntrosByClient = cache(
  async function loadExternalIntrosByClient(): Promise<Map<string, IntroLead[]>> {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("external_intros")
      .select("email, name, campaign_id, campaign_name, client_id, intro_at")
      .not("client_id", "is", null)
      .order("intro_at", { ascending: false })
      .range(0, 49_999);
    if (error || !data) return new Map();

    const byClient = new Map<string, IntroLead[]>();
    for (const r of data as Array<{
      email: string;
      name: string | null;
      campaign_id: string;
      campaign_name: string | null;
      client_id: string;
      intro_at: string | null;
    }>) {
      const lead: IntroLead = {
        thread_id: `ext:${r.email}:${r.campaign_id}`,
        assigned_at: r.intro_at ?? new Date().toISOString(),
        lead_name: r.name,
        lead_email: r.email,
        company: null,
        title: null,
        campaign_name: r.campaign_name,
        source_provider: null,
        subject: null,
        custom_fields: {},
      };
      const arr = byClient.get(r.client_id) ?? [];
      arr.push(lead);
      byClient.set(r.client_id, arr);
    }
    return byClient;
  },
);
