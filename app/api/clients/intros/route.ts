import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginated-select";
import { env } from "@/lib/env";

// GET /api/clients/intros[?label=Introduction]
//
// Returns one row per intro EVENT (label_assignments row), not per-client
// aggregates. Use this when the consumer needs to bucket by week itself
// — bucketing on the client side means we don't re-call the API on
// every "previous week" navigation, and the same payload also drives
// "last intro X days ago" without a second endpoint.
//
// Required fields per row:
//   - client_name : the matching BrokerStaffer client display name
//   - assigned_at : ISO 8601 UTC timestamp the label landed on the thread
//
// Nice-to-have fields included (consumer can ignore):
//   - client_slug, client_id, thread_id, lead_email, lead_name
//
// Sort: most-recent assignment first.
//
// Auth: normal user session OR `?token=<SUPABASE_SERVICE_ROLE_KEY>` /
// `x-admin-token: ...` header (skipping requires the proxy-level bypass
// which is already wired for any token-bearing /api/* request).

export const dynamic = "force-dynamic";

interface IntroRow {
  client_name: string;
  assigned_at: string;
  // Nice-to-have:
  client_slug: string;
  client_id: string;
  thread_id: string;
  lead_email: string | null;
  lead_name: string | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const labelName = (url.searchParams.get("label") ?? "Introduction").trim();

  const suppliedToken =
    url.searchParams.get("token") ?? request.headers.get("x-admin-token");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  let workspaceId: string;
  if (suppliedToken && serviceKey && suppliedToken === serviceKey) {
    workspaceId =
      url.searchParams.get("workspace") ?? env.WORKSPACE_ID ?? "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspace param required when using service-role token" },
        { status: 400 },
      );
    }
  } else {
    const userClient = await createServerSupabase();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = await requireSession();
    workspaceId = session.activeWorkspace.id;
  }

  const admin = createAdminSupabase();

  // Resolve the label id (case-insensitive name match).
  const { data: labelRow } = await admin
    .from("labels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", labelName)
    .maybeSingle();
  if (!labelRow?.id) {
    return NextResponse.json(
      { error: `Label "${labelName}" not found in this workspace.` },
      { status: 404 },
    );
  }

  // Pull every assignment for this label. .range() alone does NOT
  // lift Supabase's server-side db-max-rows=1000 cap — the response
  // comes back capped no matter what range the client asks for. Page
  // in 1000-row windows via fetchAllRows. See lib/db/paginated-select.
  const assignmentList = await fetchAllRows<{
    assigned_at: string;
    target_id: string;
  }>(({ from, to }) =>
    admin
      .from("label_assignments")
      .select("assigned_at, target_id")
      .eq("workspace_id", workspaceId)
      .eq("target_type", "thread")
      .eq("label_id", labelRow.id)
      .order("assigned_at", { ascending: false })
      .range(from, to),
  );

  if (assignmentList.length === 0) {
    return NextResponse.json({
      ok: true,
      label: labelName,
      label_id: labelRow.id,
      intros: [],
    });
  }

  // Bulk-resolve threads → client_id + lead_id in chunks (PostgREST URL
  // length cap on `in()`).
  const threadIds = Array.from(new Set(assignmentList.map((a) => a.target_id)));
  const threadMeta = new Map<
    string,
    { client_id: string | null; lead_id: string | null }
  >();
  const CHUNK = 500;
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const slice = threadIds.slice(i, i + CHUNK);
    const { data: threads } = await admin
      .from("threads")
      .select("id, client_id, lead_id")
      .in("id", slice);
    for (const t of (threads ?? []) as Array<{
      id: string;
      client_id: string | null;
      lead_id: string | null;
    }>) {
      threadMeta.set(t.id, { client_id: t.client_id, lead_id: t.lead_id });
    }
  }

  // Bulk-resolve clients → name + slug.
  const clientIds = Array.from(
    new Set(
      Array.from(threadMeta.values())
        .map((m) => m.client_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const clientById = new Map<string, { name: string; slug: string }>();
  if (clientIds.length > 0) {
    const { data: clients } = await admin
      .from("clients")
      .select("id, name, slug")
      .in("id", clientIds);
    for (const c of (clients ?? []) as Array<{ id: string; name: string; slug: string }>) {
      clientById.set(c.id, { name: c.name, slug: c.slug });
    }
  }

  // Bulk-resolve leads → email + full_name (nice-to-have fields).
  const leadIds = Array.from(
    new Set(
      Array.from(threadMeta.values())
        .map((m) => m.lead_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const leadById = new Map<string, { email: string | null; full_name: string | null }>();
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const slice = leadIds.slice(i, i + CHUNK);
    const { data: leads } = await admin
      .from("leads")
      .select("id, email, full_name")
      .in("id", slice);
    for (const l of (leads ?? []) as Array<{
      id: string;
      email: string | null;
      full_name: string | null;
    }>) {
      leadById.set(l.id, { email: l.email, full_name: l.full_name });
    }
  }

  // Assemble rows. Drop assignments whose thread has no client_id —
  // those threads belong to the "Unknown" fallback bucket (or pre-dating
  // the client tagging) and don't roll up to a real client.
  const intros: IntroRow[] = [];
  for (const a of assignmentList) {
    const meta = threadMeta.get(a.target_id);
    if (!meta?.client_id) continue;
    const client = clientById.get(meta.client_id);
    if (!client) continue;
    const lead = meta.lead_id ? leadById.get(meta.lead_id) : null;
    intros.push({
      client_name: client.name,
      assigned_at: a.assigned_at,
      client_slug: client.slug,
      client_id: meta.client_id,
      thread_id: a.target_id,
      lead_email: lead?.email ?? null,
      lead_name: lead?.full_name ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    label: labelName,
    label_id: labelRow.id,
    intros,
  });
}
