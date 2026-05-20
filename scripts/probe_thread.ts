// Diagnoses the "reply landed as a new Gmail thread" bug for lead
// sankalp@outreachify.io on campaign "Front Range Collective - OpsLabs Test".
//
// What we check on the Instantly side:
//   - All emails for this lead, ordered by time
//   - For each email: id, thread_id, in_reply_to / message_id headers (if exposed),
//     subject, ue_type (1 sent / 2 received), eaccount, lead_id
//   - Whether all emails share ONE thread_id (correct threading)
//     or whether the most-recent outbound is on a different thread_id
//     than the inbound it was meant to reply to (the bug).

import * as fs from "node:fs";
import * as path from "node:path";

const LEAD_EMAIL = "sankalp@outreachify.io";

const envPath = path.join(process.cwd(), ".env.local");
const envText = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.+?)"?$/);
  if (m) env[m[1]] = m[2];
}
const API_KEY = env.INSTANTLY_API_KEY;
const BASE = (env.INSTANTLY_BASE_URL ?? "https://api.instantly.ai/api/v2").replace(/\/$/, "");

async function api<T>(method: "GET" | "POST", apiPath: string, body?: unknown, query?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${apiPath}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
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
    console.error(`API ${method} ${apiPath} -> ${res.status}\n${text.slice(0, 600)}`);
    throw new Error(`api error ${res.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface EmailSlim {
  id: string;
  thread_id?: string;
  subject?: string | null;
  timestamp_email?: string;
  ue_type?: number;
  eaccount?: string;
  from_address_email?: string | null;
  to_address_email_list?: string | null;
  message_id?: string;
  body?: { text?: string };
}
interface ListResp<T> { items?: T[]; next_starting_after?: string | null }

(async () => {
  console.log(`Pulling every Instantly email involving ${LEAD_EMAIL} ...\n`);
  const collected: EmailSlim[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const q: Record<string, string | number> = { limit: 100, lead: LEAD_EMAIL };
    if (cursor) q.starting_after = cursor;
    const page = await api<ListResp<EmailSlim>>("GET", "/emails", undefined, q);
    for (const item of page.items ?? []) collected.push(item);
    if (!page.next_starting_after) break;
    cursor = page.next_starting_after;
  }
  console.log(`Total emails fetched: ${collected.length}\n`);

  // Sort oldest -> newest.
  collected.sort((a, b) => (a.timestamp_email ?? "").localeCompare(b.timestamp_email ?? ""));

  const byThread = new Map<string, EmailSlim[]>();
  for (const e of collected) {
    const key = e.thread_id ?? "(none)";
    const list = byThread.get(key) ?? [];
    list.push(e);
    byThread.set(key, list);
  }

  console.log(`Distinct thread_ids: ${byThread.size}\n`);
  for (const [tid, list] of byThread.entries()) {
    console.log(`\n=== thread_id ${tid} — ${list.length} message(s) ===`);
    for (const e of list) {
      const dir = e.ue_type === 1 ? "OUT" : e.ue_type === 2 ? "IN " : "??? ";
      const when = e.timestamp_email ?? "";
      console.log(`  [${dir}] ${when}  subject="${e.subject ?? ""}"`);
      console.log(`         id=${e.id}`);
      console.log(`         message_id=${e.message_id ?? "(none)"}`);
      console.log(`         eaccount=${e.eaccount ?? "(none)"}`);
      console.log(`         from=${e.from_address_email ?? "(none)"}`);
      console.log(`         to  =${e.to_address_email_list ?? "(none)"}`);
    }
  }

  // Drill into the last outbound: fetch its full record and dump every
  // top-level field so we can see whatever Instantly stores under
  // in_reply_to / parent_email / etc.
  const lastOut = [...collected].reverse().find((e) => e.ue_type === 1);
  if (lastOut) {
    console.log(`\n\nLAST OUTBOUND FULL RECORD (id=${lastOut.id}):`);
    const full = await api<Record<string, unknown>>("GET", `/emails/${lastOut.id}`);
    for (const [k, v] of Object.entries(full)) {
      if (k === "body" || typeof v === "object") continue;
      console.log(`  ${k}: ${v}`);
    }
    // The body separately, truncated, just so we recognise the right email.
    const body = (full.body as { text?: string; html?: string } | undefined) ?? {};
    console.log(`  body.text (first 300 chars): ${(body.text ?? "").slice(0, 300)}`);
  }
})().catch((err) => {
  console.error("probe failed:", err);
  process.exit(99);
});
