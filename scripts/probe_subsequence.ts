// One-shot probe: did `sankalp@outreachify.io` actually land in the
// "OpsLabs Interested Leads" subsequence under campaign
// "Front Range Collective - OpsLabs Test"?
//
// Run with:
//   npx tsx scripts/probe_subsequence.ts
//
// What it does:
//   1. Loads INSTANTLY_API_KEY from .env.local
//   2. Looks up the campaign by name (paginated /campaigns)
//   3. Lists subsequences for that campaign, finds the target one
//   4. Looks up the lead UUID by email (POST /leads/list with search)
//   5. Checks /leads/list with subsequence_id filter to see if the lead
//      is present in the subsequence's member list. Also dumps the lead
//      row's subsequence field if Instantly exposes one.

import * as fs from "node:fs";
import * as path from "node:path";

const LEAD_EMAIL = "sankalp@outreachify.io";
const CAMPAIGN_NAME = "Front Range Collective - OpsLabs Test";
const SUBSEQUENCE_NAME = "OpsLabs Interested Leads";

const envPath = path.join(process.cwd(), ".env.local");
const envText = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.+?)"?$/);
  if (m) env[m[1]] = m[2];
}
const API_KEY = env.INSTANTLY_API_KEY;
const BASE = (env.INSTANTLY_BASE_URL ?? "https://api.instantly.ai/api/v2").replace(/\/$/, "");
if (!API_KEY) {
  console.error("INSTANTLY_API_KEY missing in .env.local");
  process.exit(1);
}

async function api<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`API ${method} ${path} -> ${res.status}`);
    console.error(text.slice(0, 800));
    throw new Error(`api error ${res.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface CampaignSlim { id: string; name: string }
interface SubsequenceSlim {
  id: string;
  name: string;
  parent_campaign: string;
  status?: number;
  timestamp_leads_updated?: string;
}
interface LeadSlim {
  id: string;
  email: string;
  campaign?: string;
  subsequence?: string;
  status?: number;
  timestamp_created?: string;
  first_name?: string | null;
  last_name?: string | null;
}
interface ListResp<T> { items?: T[]; next_starting_after?: string | null }

async function findCampaign(name: string): Promise<CampaignSlim | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const q: Record<string, string | number> = { limit: 100 };
    if (cursor) q.starting_after = cursor;
    const page = await api<ListResp<CampaignSlim>>("GET", "/campaigns", undefined, q);
    const hit = (page.items ?? []).find((c) => c.name === name);
    if (hit) return hit;
    if (!page.next_starting_after) break;
    cursor = page.next_starting_after;
  }
  return null;
}

async function findSubsequence(parentCampaign: string, name: string): Promise<SubsequenceSlim | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const q: Record<string, string | number> = { parent_campaign: parentCampaign, limit: 100 };
    if (cursor) q.starting_after = cursor;
    const page = await api<ListResp<SubsequenceSlim>>("GET", "/subsequences", undefined, q);
    const hit = (page.items ?? []).find((s) => s.name === name);
    if (hit) return hit;
    if (!page.next_starting_after) break;
    cursor = page.next_starting_after;
  }
  return null;
}

async function findLead(email: string): Promise<LeadSlim | null> {
  const page = await api<ListResp<LeadSlim>>("POST", "/leads/list", { search: email, limit: 5 });
  return (page.items ?? []).find((l) => l.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function leadsInSubsequence(subsequenceId: string): Promise<LeadSlim[]> {
  // POST /leads/list supports a `subsequence` filter (verified live: the
  // filter key is `subsequence`, mirroring the field exposed on lead rows).
  // Walk EVERY page so we don't get a false negative on a populous subsequence.
  const collected: LeadSlim[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const body: Record<string, unknown> = { subsequence: subsequenceId, limit: 100 };
    if (cursor) body.starting_after = cursor;
    const page = await api<ListResp<LeadSlim>>("POST", "/leads/list", body);
    for (const item of page.items ?? []) collected.push(item);
    if (!page.next_starting_after) break;
    cursor = page.next_starting_after;
  }
  return collected;
}

(async () => {
  console.log(`Looking for campaign "${CAMPAIGN_NAME}" ...`);
  const campaign = await findCampaign(CAMPAIGN_NAME);
  if (!campaign) {
    console.error(`Campaign not found.`);
    process.exit(2);
  }
  console.log(`  ✓ campaign id = ${campaign.id}`);

  console.log(`Looking for subsequence "${SUBSEQUENCE_NAME}" under that campaign ...`);
  const sub = await findSubsequence(campaign.id, SUBSEQUENCE_NAME);
  if (!sub) {
    console.error(`Subsequence not found under this campaign.`);
    process.exit(3);
  }
  console.log(`  ✓ subsequence id = ${sub.id}`);
  console.log(`    status: ${sub.status}, timestamp_leads_updated: ${sub.timestamp_leads_updated ?? "-"}`);

  console.log(`Looking up lead by email "${LEAD_EMAIL}" ...`);
  const lead = await findLead(LEAD_EMAIL);
  if (!lead) {
    console.error(`Lead not found anywhere in this Instantly org.`);
    process.exit(4);
  }
  console.log(`  ✓ lead id        = ${lead.id}`);
  console.log(`    lead.campaign    = ${lead.campaign ?? "(none)"}`);
  console.log(`    lead.subsequence = ${lead.subsequence ?? "(none)"}`);
  console.log(`    matches target?  campaign=${lead.campaign === campaign.id}, subsequence=${lead.subsequence === sub.id}`);

  // Dump the lead's full record — exposes any subsequence-related field we
  // don't have in the slim type (e.g. `subsequence_status`, `parent`).
  const full = await api<unknown>("GET", `/leads/${lead.id}`);
  console.log(`\nFull lead record:\n`, JSON.stringify(full, null, 2));

  console.log(`Fetching members of subsequence "${SUBSEQUENCE_NAME}" ...`);
  const members = await leadsInSubsequence(sub.id);
  console.log(`  ✓ total members fetched: ${members.length}`);
  const inSub = members.find((m) => m.id === lead.id);
  if (inSub) {
    console.log(`\nRESULT: lead IS in the subsequence ✅`);
    console.log(`  status=${inSub.status}, created=${inSub.timestamp_created ?? "-"}`);
  } else {
    console.log(`\nRESULT: lead is NOT in the subsequence ❌`);
    console.log(`(Lead exists in Instantly but the subsequence-member list doesn't contain it.)`);
  }
})().catch((err) => {
  console.error("probe failed:", err);
  process.exit(99);
});
