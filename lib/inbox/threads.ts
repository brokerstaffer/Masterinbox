import { createServerSupabase } from "@/lib/supabase/server";
import { loadViewBySlug, type CustomView } from "@/lib/inbox/views";
import { searchThreads } from "@/lib/inbox/search";
import { OPEN_RESPONSES_PRESET, openResponsesThreadIds } from "@/lib/inbox/open-responses";
import type { FilterRow, FilterState } from "@/lib/inbox/filters";

export type SourceProvider = "emailbison" | "instantly";

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
  searchQuery: string | null = null,
): Promise<ThreadListResult> {
  const supabase = await createServerSupabase();

  // Top-bar search: when a `?q=` is present we restrict the view to the
  // threads that match it — the result renders in the normal thread list,
  // not a separate page. Resolve the matching ids up front; no matches →
  // empty result.
  let searchThreadIds: string[] | null = null;
  if (searchQuery && searchQuery.trim().length >= 2) {
    const hits = await searchThreads(workspaceId, searchQuery.trim(), 500);
    searchThreadIds = hits.map((h) => h.id);
    if (searchThreadIds.length === 0) {
      return {
        rows: [],
        total: 0,
        page: Math.max(1, Math.floor(page)),
        pageSize: THREAD_PAGE_SIZE,
      };
    }
  }

  // If a list filter is active, resolve which mode to use:
  //   - lists.client_id set ("live" list seeded one-per-client) → narrow
  //     by threads.client_id directly. Cleanest path; no UUIDs embedded
  //     in JSON.
  //   - filter_json set (live list with a custom filter — speculative,
  //     not used by the current seed but kept for future extensions) →
  //     fold its rows into the effective FilterState below.
  //   - both null (legacy manually-curated lists) → restrict by
  //     thread_list_items membership.
  const pageSize = THREAD_PAGE_SIZE;
  const safePage = Math.max(1, Math.floor(page));

  let listFilterRows: FilterRow[] = [];
  let listClientId: string | null = null;
  let listThreadIds: string[] | null = null;
  if (listId) {
    const { data: listRow } = await supabase
      .from("lists")
      .select("client_id, filter_json")
      .eq("id", listId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    listClientId = (listRow?.client_id as string | null) ?? null;
    if (!listClientId) {
      const fj = (listRow?.filter_json as { rows?: FilterRow[] } | null) ?? null;
      if (fj?.rows && fj.rows.length > 0) {
        listFilterRows = fj.rows;
      } else {
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
    }
  }

  // Build a SINGLE filtered query. `count: 'exact'` MUST be on this first
  // .select() — supabase-js only honors the count option on
  // PostgrestQueryBuilder.select(); the chained .select(detailCols, …) later
  // goes through PostgrestTransformBuilder.select() which silently ignores
  // the options arg. Without count here the response Content-Range is
  // omitted, `count` comes back null, and pagination caps at data.length.
  let query = supabase
    .from("threads")
    .select("id, last_message_at", { count: "exact" })
    .eq("workspace_id", workspaceId);

  // Sidebar destinations (not custom_views).
  //
  // Fast paths: for the well-known system view slugs (sidebar destinations
  // plus the seeded "all-email" tab) we apply the known filter directly
  // and skip the loadViewBySlug Supabase round-trip. This is the common
  // case — every active user spends most of their time on /inbox/all-email
  // — and saves ~280ms per click. The slow path (custom user views) still
  // works exactly as before.
  let cv: CustomView | null = null;
  if (view === "archive") {
    query = query.eq("status", "archived");
  } else if (view === "spam") {
    query = query.eq("status", "spam");
  } else if (view === "trash") {
    query = query.eq("status", "trash");
  } else if (view === "all-email") {
    // Seeded system view — preset 'all_email' maps to status='open'.
    // Hardcoded to skip the cv lookup entirely.
    query = query.eq("status", "open");
  } else {
    cv = await loadViewBySlug(workspaceId, view);
    query = applyViewPreset(query as unknown as Q, cv) as typeof query;
  }

  // "Open Responses" — an OR-of-two-conditions view the FilterBuilder
  // can't express. Resolve the matching thread ids up front and restrict
  // the query to them (same pattern as the top-bar search path).
  let openResponseIds: string[] | null = null;
  if ((cv?.filter_json as { preset?: string } | undefined)?.preset === OPEN_RESPONSES_PRESET) {
    const set = await openResponsesThreadIds(supabase, workspaceId);
    if (set.size === 0) {
      return { rows: [], total: 0, page: safePage, pageSize };
    }
    openResponseIds = Array.from(set);
  }

  // Effective FilterState: URL > view.filter_json.rows
  const viewRows = (cv?.filter_json as { rows?: FilterRow[] } | undefined)?.rows;
  const state: FilterState =
    filterFromUrl && filterFromUrl.rows.length > 0
      ? filterFromUrl
      : viewRows
        ? { rows: viewRows }
        : { rows: [] };

  // Fold the list's own filter_json rows (live lists, e.g. "client = X")
  // into the active rows. Listing in a live list = "show me threads
  // matching this filter, narrowed further by whatever filter rows the
  // view / URL is applying on top".
  const activeRows: FilterRow[] = [...state.rows, ...listFilterRows];

  // Apply each active filter row to the query. Some filters need post-query
  // work (e.g. domain, message_counts). Build an `extraFilter` callback to run
  // over results after the SQL pass.
  const postFilters: Array<(t: ThreadRow & { _raw: Record<string, unknown> }) => boolean> = [];

  for (const row of activeRows) {
    if (!row.enabled) continue;
    query = applyRowToQuery(query as unknown as Q, row, workspaceId, supabase, postFilters) as typeof query;
  }

  // Resolve any async label/channel filter expansions first.
  const resolved = await Promise.all(
    activeRows
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

  if (listClientId) {
    query = query.eq("client_id", listClientId) as typeof query;
  }
  if (listThreadIds !== null) {
    query = query.in("id", listThreadIds);
  }
  if (searchThreadIds !== null) {
    query = query.in("id", searchThreadIds) as typeof query;
  }
  if (openResponseIds !== null) {
    query = query.in("id", openResponseIds) as typeof query;
  }

  // Single round-trip: fetch the page detail rows AND the total count in
  // one PostgREST request via `count: 'exact'` + `.range()`. Previously
  // this was 2 sequential RTTs — a `select id` over up to 50k rows
  // (~280ms) followed by `select detail where id in (page)` (~280ms).
  // Collapsed via count+range, plus fetching ALL workspace
  // label_assignments in parallel rather than a follow-up IN clause
  // gated on the page IDs. Per-click savings: 1 sequential round-trip
  // (~280ms) on every navigation.
  //
  // Trade-off: post-filters (domain, name, email) still run client-side,
  // so the displayed total can be slightly off when they exclude rows.
  // Accepted; post-filters are rare in the typical view.
  const offset = (safePage - 1) * pageSize;
  // Swap the select column list to fetch detail rows. The count option lives
  // on the initial QueryBuilder.select() above — this second call goes
  // through TransformBuilder.select() and only updates the `select=` URL
  // param. The Prefer: count=exact header set earlier is preserved.
  const detailQuery = query.select(
    `id, subject, last_message_at, last_message_preview, needs_reply, seen, message_count, source_provider, campaign_id, campaign_name,
       leads:lead_id(full_name, email, company),
       channels:channel_id(provider),
       clients:client_id(name, slug)`,
  );
  const pagedQuery = (
    detailQuery.order("last_message_at", {
      ascending: false,
      nullsFirst: false,
    }) as unknown as {
      range(from: number, to: number): Promise<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
        count: number | null;
      }>;
    }
  ).range(offset, offset + pageSize - 1);

  const [pageResult, assignmentsResult] = await Promise.all([
    pagedQuery,
    // Fetch label_assignments for every thread in the workspace and join
    // in JS. Workspaces typically have hundreds of assignments — cheap
    // payload (~10-30KB) for the latency saved by not gating on page IDs.
    supabase
      .from("label_assignments")
      .select("target_id, labels:label_id(name, color)")
      .eq("workspace_id", workspaceId)
      .eq("target_type", "thread"),
  ]);
  const { data, error, count } = pageResult;
  const assignments = assignmentsResult.data;
  if (error) {
    console.error("[loadThreads] page query failed", error);
    return { rows: [], total: 0, page: safePage, pageSize };
  }
  const total = count ?? data?.length ?? 0;
  const ordered = data ?? [];
  if (ordered.length === 0) {
    return { rows: [], total, page: safePage, pageSize };
  }

  const labelsByThread = new Map<string, Array<{ name: string; color: string }>>();
  for (const r of assignments ?? []) {
    const ra = r as { target_id: string; labels: { name: string; color: string } | { name: string; color: string }[] | null };
    const label = Array.isArray(ra.labels) ? ra.labels[0] : ra.labels;
    if (!label) continue;
    const list = labelsByThread.get(ra.target_id) ?? [];
    list.push({ name: label.name, color: label.color });
    labelsByThread.set(ra.target_id, list);
  }

  type Lead = { full_name?: string | null; email?: string | null; company?: string | null };
  type Channel = { provider?: SourceProvider | null };
  type Client = { name?: string | null; slug?: string | null };
  let mapped: ThreadRow[] = ordered.map((rawRow) => {
    const row = rawRow as Record<string, unknown> & {
      id: string;
      leads: Lead | Lead[] | null;
      channels: Channel | Channel[] | null;
      clients: Client | Client[] | null;
    };
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const channel = Array.isArray(row.channels) ? row.channels[0] : row.channels;
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    return {
      id: row.id,
      subject: (row.subject as string | null) ?? null,
      last_message_at: (row.last_message_at as string | null) ?? null,
      last_message_preview: (row.last_message_preview as string | null) ?? null,
      needs_reply: Boolean(row.needs_reply),
      seen: (row.seen as boolean | null) ?? true,
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

  // Apply post-SQL filters (domain match, etc.) — uses the same
  // activeRows that drove the SQL-level filter chain so live-list
  // narrowing isn't dropped at the post-filter pass.
  for (const row of activeRows) {
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
    case OPEN_RESPONSES_PRESET:
      // open_responses: base filter is status=open; the OR membership is
      // applied as an id restriction back in loadThreads.
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
    case "clients": {
      // Values are client_id UUIDs. Empty list means "no filter".
      const ids = Array.isArray(row.value) ? (row.value as string[]) : [];
      if (ids.length === 0) return query;
      if (row.operator === "is") return query.in("client_id", ids) as Q;
      if (row.operator === "not") {
        return query.not("client_id", "in", `(${ids.join(",")})`) as Q;
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
