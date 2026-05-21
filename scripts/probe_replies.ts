// Audits reply capture: what's in our DB vs what Instantly has.
// Run:  npx tsx scripts/probe_replies.ts

import * as fs from "node:fs";
import * as path from "node:path";

const WORKSPACE_ID = "8c097b98-7f6e-440a-8987-32e110563b8c";

const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.+?)"?$/);
  if (m) env[m[1]] = m[2];
}
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const INST_KEY = env.INSTANTLY_API_KEY;
const INST_BASE = (env.INSTANTLY_BASE_URL ?? "https://api.instantly.ai/api/v2").replace(/\/$/, "");

async function sb<T>(p: string): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1${p}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`SB ${p} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}
async function inst<T>(p: string): Promise<T> {
  const res = await fetch(`${INST_BASE}${p}`, {
    headers: { Authorization: `Bearer ${INST_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`INST ${p} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

(async () => {
  // ---- Our DB ----
  const threads = await sb<
    Array<{ id: string; client_id: string | null; source_provider: string | null; status: string }>
  >(`/threads?workspace_id=eq.${WORKSPACE_ID}&select=id,client_id,source_provider,status&limit=50000`);
  const clients = await sb<Array<{ id: string; name: string; slug: string }>>(
    `/clients?select=id,name,slug&limit=200`,
  );
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const unknownId = clients.find((c) => c.slug === "unknown")?.id ?? null;

  console.log(`\n=== OUR DATABASE — ${threads.length} threads total ===`);

  const byStatus = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byClient = new Map<string, number>();
  let untagged = 0;
  for (const t of threads) {
    byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    bySource.set(t.source_provider ?? "(none)", (bySource.get(t.source_provider ?? "(none)") ?? 0) + 1);
    if (!t.client_id) untagged++;
    else byClient.set(t.client_id, (byClient.get(t.client_id) ?? 0) + 1);
  }

  console.log("\nBy status:", Object.fromEntries(byStatus));
  console.log("By source:", Object.fromEntries(bySource));
  console.log(`Threads with NO client_id at all: ${untagged}`);
  console.log(
    `Threads tagged "Unknown": ${unknownId ? byClient.get(unknownId) ?? 0 : "(no unknown client)"}`,
  );

  console.log("\nThreads per client (desc):");
  const rows = Array.from(byClient.entries())
    .map(([id, n]) => ({ name: clientName.get(id) ?? id, n }))
    .sort((a, b) => b.n - a.n);
  for (const r of rows) console.log(`  ${String(r.n).padStart(4)}  ${r.name}`);

  // Spotlight on the clients the user flagged.
  console.log("\nFlagged clients:");
  for (const target of ["EXR", "Properties & Estates", "Spotlight", "Howard Hanna"]) {
    const match = rows.find((r) => r.name.toLowerCase().includes(target.toLowerCase()));
    console.log(`  ${target}: ${match ? `${match.n} threads (${match.name})` : "NOT FOUND / 0"}`);
  }

  // ---- Instantly cross-check ----
  console.log(`\n=== INSTANTLY — received emails (cross-check) ===`);
  let received = 0;
  const instThreadIds = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < 60; i++) {
    const q = new URLSearchParams({ limit: "100", email_type: "received" });
    if (cursor) q.set("starting_after", cursor);
    const page = await inst<{ items?: Array<{ thread_id?: string }>; next_starting_after?: string }>(
      `/emails?${q.toString()}`,
    );
    for (const e of page.items ?? []) {
      received++;
      if (e.thread_id) instThreadIds.add(e.thread_id);
    }
    if (!page.next_starting_after) break;
    cursor = page.next_starting_after;
  }
  console.log(`  Received emails in Instantly:        ${received}`);
  console.log(`  Distinct Instantly conversations:    ${instThreadIds.size}`);
  console.log(`  Instantly threads in our DB:         ${bySource.get("instantly") ?? 0}`);
  const gap = instThreadIds.size - (bySource.get("instantly") ?? 0);
  console.log(
    gap > 0
      ? `  ⚠️  Gap: ${gap} Instantly conversations not in our DB`
      : `  ✓ Our DB has every Instantly conversation (or more — replies arrive as separate threads).`,
  );
})().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
