// Probes the data that GET /api/clients/intro-stats would return without
// going through the HTTP layer. Useful to verify:
//   - There's a label named "Introduction" in the Corofy workspace.
//   - There's at least one label_assignments row for that label.
//   - The row has a non-null assigned_at (the timestamp the label was attached).
//   - The thread it points to has a client_id (so the stat actually buckets).
//
// Run:  npx tsx scripts/probe_intro_stats.ts

import * as fs from "node:fs";
import * as path from "node:path";

const WORKSPACE_ID = "8c097b98-7f6e-440a-8987-32e110563b8c";
const LABEL_NAME = "Introduction";

const envPath = path.join(process.cwd(), ".env.local");
const envText = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.+?)"?$/);
  if (m) env[m[1]] = m[2];
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`REST ${path} -> ${res.status}\n${text.slice(0, 500)}`);
    throw new Error("rest error");
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

(async () => {
  console.log(`1. Looking up label "${LABEL_NAME}" in workspace ${WORKSPACE_ID} ...`);
  const labels = await rest<Array<{ id: string; name: string }>>(
    `/labels?workspace_id=eq.${WORKSPACE_ID}&name=ilike.${encodeURIComponent(LABEL_NAME)}`,
  );
  if (labels.length === 0) {
    console.error(`  ✗ Label "${LABEL_NAME}" not found. Create it in Settings → Labels first.`);
    process.exit(2);
  }
  const labelId = labels[0].id;
  console.log(`  ✓ label id = ${labelId}`);

  console.log(`\n2. Pulling label_assignments rows for that label ...`);
  const assignments = await rest<
    Array<{ id: string; target_id: string; assigned_at: string; assigned_by: string }>
  >(
    `/label_assignments?workspace_id=eq.${WORKSPACE_ID}&label_id=eq.${labelId}&target_type=eq.thread&select=id,target_id,assigned_at,assigned_by`,
  );
  console.log(`  ✓ found ${assignments.length} row(s)`);
  for (const a of assignments) {
    console.log(`    - assignment ${a.id}`);
    console.log(`      target_id   = ${a.target_id}`);
    console.log(`      assigned_at = ${a.assigned_at}`);
    console.log(`      assigned_by = ${a.assigned_by}`);
  }
  if (assignments.length === 0) {
    console.log(`  (No rows yet — the endpoint will return count=0 for every client.)`);
    process.exit(0);
  }

  console.log(`\n3. Resolving threads + clients for each assignment ...`);
  for (const a of assignments) {
    const threads = await rest<
      Array<{
        id: string;
        client_id: string | null;
        clients: { id: string; name: string; slug: string } | null;
      }>
    >(
      `/threads?id=eq.${a.target_id}&select=id,client_id,clients(id,name,slug)`,
    );
    const t = threads[0];
    if (!t) {
      console.log(`    [missing thread ${a.target_id}]`);
      continue;
    }
    const client = Array.isArray(t.clients) ? t.clients[0] : t.clients;
    console.log(
      `    thread ${t.id}  →  client: ${client?.name ?? "(none)"} (${client?.slug ?? "—"}), assigned_at: ${a.assigned_at}`,
    );
  }

  console.log(`\n4. Per-client roll-up (mirrors the API endpoint logic):`);
  const buckets = new Map<string, { name: string; slug: string; count: number; last: string }>();
  for (const a of assignments) {
    const threads = await rest<
      Array<{ client_id: string | null; clients: { id: string; name: string; slug: string } | null }>
    >(`/threads?id=eq.${a.target_id}&select=client_id,clients(id,name,slug)`);
    const t = threads[0];
    const client = Array.isArray(t?.clients) ? t.clients[0] : t?.clients;
    if (!client) continue;
    const prev = buckets.get(client.id) ?? { name: client.name, slug: client.slug, count: 0, last: "" };
    prev.count += 1;
    if (a.assigned_at > prev.last) prev.last = a.assigned_at;
    buckets.set(client.id, prev);
  }
  const stats = Array.from(buckets.entries()).map(([client_id, b]) => ({
    client_id,
    client_name: b.name,
    client_slug: b.slug,
    count: b.count,
    last_assigned_at: b.last,
  }));
  console.log(JSON.stringify(stats, null, 2));
})().catch((err) => {
  console.error("probe failed:", err);
  process.exit(99);
});
