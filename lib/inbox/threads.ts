import { createServerSupabase } from "@/lib/supabase/server";
import { loadViewBySlug, type CustomView } from "@/lib/inbox/views";
import type { FilterRow, FilterState } from "@/lib/inbox/filters";

export type SourceProvider = "emailbison" | "instantly" | "unipile";

export interface ThreadRow {
  id: string;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  needs_reply: boolean;
  seen: boolean;
  lead_full_name: string | null;
  lead_email: string | null;
  lead_company: string | null;
  channel_provider: SourceProvider | null;
  source_provider: SourceProvider | null;
  client_name: string | null;
  client_slug: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  labels: Array<{ name: string; color: string }>;
}

type Q = ReturnType<ReturnType<Awaited<ReturnType<typeof createServerSupabase>>["from"]>["select"]>;

// Resolve the active FilterState for a request. Priority:
//   1. URL `?f=` (ad-hoc filter from FilterBuilder Apply)
//   2. custom_view.filter_json (when the view was saved with rows)
//   3. legacy preset on the view (preset: "all_email" etc.)
export const THREAD_PAGE_SIZE = 100;

export interface ThreadListResult {
  rows: ThreadRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function loadThreads(
  workspaceId: string,
  view: string,
  filterFromUrl: FilterState | null,
  listId: string | null = null,
  page = 1,
): Promise<ThreadListResult> {
  const supabase = await createServerSupabase();

  // If a list filter is active, resolve the thread ids in that list first.
  // Returning early when the list is empty avoids an unnecessary query.
  const pageSize = THREAD_PAGE_SIZE;
  const safePage = Math.max(1, Math.floor(page));

  let listThreadIds: string[] | null = null;
  if (listId) {
    const { data } = await supabase
      .from("thread_list_items")
      .select("thread_id")
      .eq("list_id", listId)
      .eq("workspace_id", workspaceId);
    listThreadIds = (data ?? []).map((r) => r.thread_id as string);
    if (listThreadIds.length === 0) {
      return { rows: [], total: 0, page: safePage, pageSize };
    }
  }

  // Build a SINGLE filtered ID query. We fetch every matching thread id
  // (id is 36 bytes — even 10k threads is < 400 KB), then derive the count
  // and the current page from it. This avoids mirroring the filter chain
  // across two builders and sidesteps PostgREST's inline count flakiness.
  let query = supabase
    .from("threads")
    .select("id, last_message_at")
    .eq("workspace_id", workspaceId);

  // Sidebar destinations (not custom_views).
  let cv: CustomView | null = null;
  if (view === "archive") {
    query = query.eq("status", "archived");
  } else if (view === "spam") {
    query = query.eq("status", "spam");
  } else if (view === "trash") {
    query = query.eq("status", "trash");
  } else {
    cv = await loadViewBySlug(workspaceId, view);
    query = applyViewPreset(query as unknown as Q, cv) as typeof query;
  }

  // Effective FilterState: URL > view.filter_json.rows
  const viewRows = (cv?.filter_json as { rows?: FilterRow[] } | undefined)?.rows;
  const state: FilterState =
    filterFromUrl && filterFromUrl.rows.length > 0
      ? filterFromUrl
      : viewRows
        ? { rows: viewRows }
        : { rows: [] };

  // Apply each active filter row to the query. Some filters need post-query
  // work (e.g. domain, message_counts). Build an `extraFilter` callback to run
  // over results after the SQL pass.
  const postFilters: Array<(t: ThreadRow & { _raw: Record<string, unknown> }) => boolean> = [];

  for (const row of state.rows) {
    if (!row.enabled) continue;
    query = applyRowToQuery(query as unknown as Q, row, workspaceId, supabase, postFilters) as typeof query;
  }

  // Resolve any async label/channel filter expansions first.
  const resolved = await Promise.all(
    state.rows
      .filter((r) => r.enabled)
      .map((r) => prepRow(r, workspaceId, supabase)),
  );
  for (const r of resolved) {
    if (r?.idIn !== undefined) {
      if (r.idIn.length === 0) {
        return { rows: [], total: 0, page: safePage, pageSize };
      }
      query = query.in("id", r.idIn) as typeof query;
    }
    if (r?.idNotIn !== undefined && r.idNotIn.length > 0) {
      query = query.not("id", "in", `(${r.idNotIn.join(",")})`) as typeof query;
    }
  }

  if (listThreadIds !== null) {
    query = query.in("id", listThreadIds);
  }

  // Pull every matching id ordered by last activity. The default PostgREST
  // max-rows cap can limit this — set a high explicit ceiling so workspaces
  // up to 50k threads aren't truncated.
  query = query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50000);

  const { data: idRows, error: idErr } = await query;
  if (idErr) {
    console.error("[loadThreads] id query failed", idErr);
    return { rows: [], total: 0, page: safePage, pageSize };
  }
  const allIds = (idRows ?? []).map((r) => r.id as string);
  const total = allIds.length;
  const offset = (safePage - 1) * pageSize;
  const pageIds = allIds.slice(offset, offset + pageSize);

  if (pageIds.length === 0) {
    return { rows: [], total, page: safePage, pageSize };
  }

  // Fetch the visible page's thread details + their label assignments in
  // parallel — both depend only on pageIds and don't need each other's
  // results. Saves one Supabase round-trip per inbox render.
  const [
    { data, error },
    { data: assignments },
  ] = await Promise.all([
    supabase
      .from("threads")
      .select(
        `id, subject, last_message_at, last_message_preview, needs_reply, seen, message_count, source_provider, campaign_id, campaign_name,
       leads:lead_id(full_name, email, company),
       channels:channel_id(provider),
       clients:client_id(name, slug)`,
      )
      .in("id", pageIds),
    supabase
      .from("label_assignments")
      .select("target_id, labels:label_id(name, color)")
      .eq("target_type", "thread")
      .in("target_id", pageIds),
  ]);
  if (error) {
    console.error("[loadThreads] detail query failed", error);
    return { rows: [], total, page: safePage, pageSize };
  }

  // Preserve the page order (Supabase `in()` doesn't guarantee it).
  const orderIndex = new Map(pageIds.map((id, i) => [id, i]));
  const ordered = [...(data ?? [])].sort(
    (a, b) => (orderIndex.get(a.id as string) ?? 0) - (orderIndex.get(b.id as string) ?? 0),
  );

  const labelsByThread = new Map<string, Array<{ name: string; color: string }>>();
  for (const r of assignments ?? []) {
    const label = Array.isArray(r.labels) ? r.labels[0] : r.labels;
    if (!label) continue;
    const list = labelsByThread.get(r.target_id) ?? [];
    list.push({ name: label.name, color: label.color });
    labelsByThread.set(r.target_id, list);
  }

  let mapped: ThreadRow[] = ordered.map((row) => {
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const channel = Array.isArray(row.channels) ? row.channels[0] : row.channels;
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    return {
      id: row.id,
      subject: row.subject,
      last_message_at: row.last_message_at,
      last_message_preview: row.last_message_preview,
      needs_reply: row.needs_reply,
      seen: row.seen ?? true,
      lead_full_name: lead?.full_name ?? null,
      lead_email: lead?.email ?? null,
      lead_company: lead?.company ?? null,
      channel_provider: (channel?.provider ?? null) as ThreadRow["channel_provider"],
      // Prefer the denormalised source_provider on the thread (set at sync
      // time) — falls back to the channel's provider for legacy rows that
      // haven't been re-synced since the 0010 migration.
      source_provider:
        ((row.source_provider as SourceProvider | null) ??
          (channel?.provider as SourceProvider | null) ??
          null),
      client_name: client?.name ?? null,
      client_slug: client?.slug ?? null,
      campaign_id: (row.campaign_id as string | null) ?? null,
      campaign_name: (row.campaign_name as string | null) ?? null,
      labels: labelsByThread.get(row.id) ?? [],
    };
  });

  // Apply post-SQL filters (domain match, etc.)
  for (const row of state.rows) {
    if (!row.enabled) continue;
    mapped = mapped.filter(filterPredicateForRow(row));
  }

  return {
    rows: mapped,
    total,
    page: safePage,
    pageSize,
  };
}

function applyViewPreset(query: Q, view: CustomView | null): Q {
  if (!view) return query.eq("status", "open") as Q;
  const f = view.filter_json as { preset?: string };
  switch (f.preset) {
    case "needs_reply":
      return query.eq("status", "open").eq("needs_reply", true) as Q;
    case "all_email":
    case "custom_filter":
      return query.eq("status", "open") as Q;
    case "engaged":
      return query.eq("status", "open").gte("message_count", 3) as Q;
    default:
      return query.eq("status", "open") as Q;
  }
}

// Apply a row's SQL-expressible conditions directly. Returns the chained query.
// Label and channel rows are handled via prepRow (async — needs id lookups).
function applyRowToQuery(
  query: Q,
  row: FilterRow,
  _workspaceId: string,
  _supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  _post: Array<(t: ThreadRow & { _raw: Record<string, unknown> }) => boolean>,
): Q {
  switch (row.field) {
    case "subject": {
      const text = String(row.value ?? "").trim();
      if (!text) return query;
      return query.ilike("subject", `%${text}%`) as Q;
    }
    case "message_counts": {
      const n = Number(row.value);
      if (!Number.isFinite(n)) return query;
      // We use thread.message_count as a proxy for both sent + received until
      // dedicated denormalised counters land in the schema.
      if (row.operator === "equals") return query.eq("message_count", n) as Q;
      if (row.operator === "greater_than") return query.gt("message_count", n) as Q;
      if (row.operator === "less_than") return query.lt("message_count", n) as Q;
      return query;
    }
    case "reply_since": {
      // reply_since: ">3 days" => last_message_at older than 3 days ago.
      const days = Number(row.value);
      if (!Number.isFinite(days)) return query;
      const threshold = new Date(Date.now() - days * 86400_000).toISOString();
      if (row.operator === "greater_than") return query.lt("last_message_at", threshold) as Q;
      if (row.operator === "less_than") return query.gt("last_message_at", threshold) as Q;
      return query;
    }
    case "last_message_from":
      // Approximated via threads.needs_reply: needs_reply=false ⇒ last from Me,
      // needs_reply=true ⇒ last from Lead. Refined when we add a denormalised
      // last_direction column.
      if (row.value === "me") return query.eq("needs_reply", false) as Q;
      if (row.value === "lead") return query.eq("needs_reply", true) as Q;
      return query;
    case "channels": {
      const ids = Array.isArray(row.value) ? (row.value as string[]) : [];
      if (ids.length === 0) return query;
      if (row.operator === "is") return query.in("channel_id", ids) as Q;
      if (row.operator === "not") return query.not("channel_id", "in", `(${ids.join(",")})`) as Q;
      return query;
    }
    case "campaigns": {
      // Values are campaign_id strings (text). Empty list means "no filter".
      const ids = Array.isArray(row.value) ? (row.value as string[]) : [];
      if (ids.length === 0) return query;
      if (row.operator === "is") return query.in("campaign_id", ids) as Q;
      if (row.operator === "not") {
        // PostgREST string interpolation: campaign_id values are opaque
        // (UUIDs or numeric strings) — no embedded commas — so a simple
        // join is safe.
        return query.not("campaign_id", "in", `(${ids.join(",")})`) as Q;
      }
      return query;
    }
    default:
      return query;
  }
}

// Async label / channel resolution. For label IS / NOT we need a list of
// thread ids that have ANY of the selected labels.
async function prepRow(
  row: FilterRow,
  workspaceId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<{ idIn?: string[]; idNotIn?: string[] } | null> {
  if (row.field !== "labels") return null;
  const ids = Array.isArray(row.value) ? (row.value as string[]) : [];
  if (ids.length === 0) return null;

  const { data } = await supabase
    .from("label_assignments")
    .select("target_id")
    .eq("workspace_id", workspaceId)
    .eq("target_type", "thread")
    .in("label_id", ids);
  const targetIds = Array.from(new Set((data ?? []).map((r) => r.target_id as string)));

  if (row.operator === "is") return { idIn: targetIds };
  if (row.operator === "not") return { idNotIn: targetIds };
  return null;
}

// Post-SQL row predicates (for fields that can't be expressed in one Supabase
// chain — currently domain matching against lead.email).
function filterPredicateForRow(row: FilterRow): (t: ThreadRow) => boolean {
  switch (row.field) {
    case "domain": {
      const needle = String(row.value ?? "").trim().toLowerCase();
      if (!needle) return () => true;
      return (t) => (t.lead_email ?? "").toLowerCase().endsWith(`@${needle}`) || (t.lead_email ?? "").toLowerCase().includes(needle);
    }
    case "name": {
      const needle = String(row.value ?? "").trim().toLowerCase();
      if (!needle) return () => true;
      if (row.operator === "equals") return (t) => (t.lead_full_name ?? "").toLowerCase() === needle;
      return (t) => (t.lead_full_name ?? "").toLowerCase().includes(needle);
    }
    case "email": {
      const needle = String(row.value ?? "").trim().toLowerCase();
      if (!needle) return () => true;
      if (row.operator === "equals") return (t) => (t.lead_email ?? "").toLowerCase() === needle;
      return (t) => (t.lead_email ?? "").toLowerCase().includes(needle);
    }
    default:
      return () => true;
  }
}
