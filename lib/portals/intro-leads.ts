import { createAdminSupabase } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

// Shared "Introduction"-label data layer for the client portals.
//
// Both the internal admin page and the PUBLIC per-client portal read from
// here. The public portal has no logged-in user, so RLS (which is
// workspace-member gated) cannot enforce the per-client boundary — this
// module uses the service-role admin client and filters by client_id in
// code. Treat the client_id argument as the security boundary.
//
// Resolution path mirrors app/api/clients/intros/route.ts:
//   Introduction label → label_assignments (thread targets) → threads →
//   leads. Threads are chunked through `in()` to stay under PostgREST's
//   URL-length cap.

const CHUNK = 500;
const INTRO_LABEL_NAME = "Introduction";

export interface IntroLead {
  thread_id: string;
  assigned_at: string; // ISO 8601 UTC — when the Introduction label landed
  lead_name: string | null;
  lead_email: string | null;
  company: string | null;
  title: string | null;
  campaign_name: string | null;
  source_provider: string | null; // "emailbison" | "instantly" | null
  subject: string | null;
  // Webhook custom variables / enrichment carried on the lead.
  custom_fields: Record<string, unknown>;
}

export interface IntroSummary {
  count: number;
  lastAt: string | null;
}

// Resolve the Introduction label id for the Corofy workspace. Returns null
// if the label doesn't exist yet (portal then shows an empty state).
async function resolveIntroLabelId(
  admin: ReturnType<typeof createAdminSupabase>,
): Promise<string | null> {
  const workspaceId = env.COROFY_WORKSPACE_ID;
  if (!workspaceId) return null;
  const { data } = await admin
    .from("labels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", INTRO_LABEL_NAME)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// Every Introduction assignment across all clients, as raw (thread, when)
// pairs. Internal helper — callers below shape it per their need.
async function loadAllIntroAssignments(
  admin: ReturnType<typeof createAdminSupabase>,
): Promise<Array<{ target_id: string; assigned_at: string }>> {
  const labelId = await resolveIntroLabelId(admin);
  if (!labelId) return [];
  const workspaceId = env.COROFY_WORKSPACE_ID;
  const { data } = await admin
    .from("label_assignments")
    .select("target_id, assigned_at")
    .eq("workspace_id", workspaceId)
    .eq("target_type", "thread")
    .eq("label_id", labelId)
    .order("assigned_at", { ascending: false })
    .range(0, 49_999);
  return (data ?? []) as Array<{ target_id: string; assigned_at: string }>;
}

// Per-client roll-up for the admin grid: count of Introduction leads and
// the most recent one, keyed by client_id.
export async function loadIntroSummaryByClient(): Promise<Map<string, IntroSummary>> {
  const admin = createAdminSupabase();
  const assignments = await loadAllIntroAssignments(admin);
  if (assignments.length === 0) return new Map();

  // thread_id → client_id
  const threadIds = Array.from(new Set(assignments.map((a) => a.target_id)));
  const threadClient = new Map<string, string | null>();
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const slice = threadIds.slice(i, i + CHUNK);
    const { data } = await admin
      .from("threads")
      .select("id, client_id")
      .in("id", slice);
    for (const t of (data ?? []) as Array<{ id: string; client_id: string | null }>) {
      threadClient.set(t.id, t.client_id);
    }
  }

  const byClient = new Map<string, IntroSummary>();
  for (const a of assignments) {
    const clientId = threadClient.get(a.target_id);
    if (!clientId) continue;
    const prev = byClient.get(clientId) ?? { count: 0, lastAt: null };
    prev.count += 1;
    if (!prev.lastAt || a.assigned_at > prev.lastAt) prev.lastAt = a.assigned_at;
    byClient.set(clientId, prev);
  }
  return byClient;
}

// Every Introduction lead for ONE client, newest first. This is the
// payload behind both the admin drill-down and the public portal — the
// clientId argument is the hard per-client boundary.
export async function loadClientIntroLeads(clientId: string): Promise<IntroLead[]> {
  const admin = createAdminSupabase();
  const assignments = await loadAllIntroAssignments(admin);
  if (assignments.length === 0) return [];

  // Resolve threads → keep only the ones belonging to this client.
  const threadIds = Array.from(new Set(assignments.map((a) => a.target_id)));
  const threadMeta = new Map<
    string,
    {
      client_id: string | null;
      lead_id: string | null;
      campaign_name: string | null;
      source_provider: string | null;
      subject: string | null;
    }
  >();
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const slice = threadIds.slice(i, i + CHUNK);
    const { data } = await admin
      .from("threads")
      .select("id, client_id, lead_id, campaign_name, source_provider, subject")
      .in("id", slice);
    for (const t of (data ?? []) as Array<{
      id: string;
      client_id: string | null;
      lead_id: string | null;
      campaign_name: string | null;
      source_provider: string | null;
      subject: string | null;
    }>) {
      threadMeta.set(t.id, {
        client_id: t.client_id,
        lead_id: t.lead_id,
        campaign_name: t.campaign_name,
        source_provider: t.source_provider,
        subject: t.subject,
      });
    }
  }

  // Lead ids only for this client's threads.
  const leadIds = new Set<string>();
  for (const a of assignments) {
    const meta = threadMeta.get(a.target_id);
    if (meta?.client_id === clientId && meta.lead_id) leadIds.add(meta.lead_id);
  }
  const leadById = new Map<
    string,
    {
      full_name: string | null;
      email: string | null;
      company: string | null;
      title: string | null;
      custom_fields: Record<string, unknown>;
    }
  >();
  const leadIdList = Array.from(leadIds);
  for (let i = 0; i < leadIdList.length; i += CHUNK) {
    const slice = leadIdList.slice(i, i + CHUNK);
    const { data } = await admin
      .from("leads")
      .select("id, full_name, email, company, title, custom_fields")
      .in("id", slice);
    for (const l of (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      company: string | null;
      title: string | null;
      custom_fields: Record<string, unknown> | null;
    }>) {
      leadById.set(l.id, {
        full_name: l.full_name,
        email: l.email,
        company: l.company,
        title: l.title,
        custom_fields: l.custom_fields ?? {},
      });
    }
  }

  const out: IntroLead[] = [];
  for (const a of assignments) {
    const meta = threadMeta.get(a.target_id);
    if (!meta || meta.client_id !== clientId) continue; // per-client boundary
    const lead = meta.lead_id ? leadById.get(meta.lead_id) : null;
    out.push({
      thread_id: a.target_id,
      assigned_at: a.assigned_at,
      lead_name: lead?.full_name ?? null,
      lead_email: lead?.email ?? null,
      company: lead?.company ?? null,
      title: lead?.title ?? null,
      campaign_name: meta.campaign_name,
      source_provider: meta.source_provider,
      subject: meta.subject,
      custom_fields: lead?.custom_fields ?? {},
    });
  }
  // assignments already came back newest-first; preserve that order.
  return out;
}

export interface TrendBucket {
  weekStart: string; // ISO date (Monday) of the week
  label: string; // e.g. "May 19"
  count: number;
}

// Buckets intro events into the last `weeks` ISO weeks (Monday-start) for
// the portal's trend bar chart. Always returns exactly `weeks` buckets,
// oldest → newest, so the chart has a stable shape even with sparse data.
export function weeklyTrend(leads: IntroLead[], weeks = 12): TrendBucket[] {
  const mondayOf = (d: Date): Date => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = x.getUTCDay(); // 0 Sun … 6 Sat
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    x.setUTCDate(x.getUTCDate() - diff);
    return x;
  };

  const now = new Date();
  const thisMonday = mondayOf(now);

  const buckets: TrendBucket[] = [];
  const indexByKey = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisMonday);
    ws.setUTCDate(ws.getUTCDate() - i * 7);
    const key = ws.toISOString().slice(0, 10);
    indexByKey.set(key, buckets.length);
    buckets.push({
      weekStart: key,
      label: ws.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      count: 0,
    });
  }

  for (const lead of leads) {
    const d = new Date(lead.assigned_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = mondayOf(d).toISOString().slice(0, 10);
    const idx = indexByKey.get(key);
    if (idx !== undefined) buckets[idx].count += 1;
  }
  return buckets;
}
