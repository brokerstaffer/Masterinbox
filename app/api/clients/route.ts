import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/workspace";
import { _invalidateClientCache, deriveClientIdFromCampaign } from "@/lib/clients/derive";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";

// GET  /api/clients          -> list every client (id, name, slug, aliases, thread_count)
// POST /api/clients          -> create a new client { name, aliases? }
//
// Auth: any signed-in workspace member can read; member can write (BrokerStaffer
// is single-tenant). The clients table is a global catalog (no
// workspace_id) so we don't filter by workspace.

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "client";
}

// Random lowercase hex string — used to make portal tokens unguessable.
function randomHex(len: number): string {
  return randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

export async function GET() {
  const user = await requireAuthedUser();
  if ("error" in user) return user.error;

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("clients")
    .select("id, name, slug, aliases, created_at")
    .order("name", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Tag each client with how many threads currently point at it. The
  // previous implementation pulled every `threads.client_id` row (a
  // 10k-row table scan that was the worst offender behind the
  // "settings feels laggy" report); replaced with N parallel HEAD
  // counts. For ~25 clients that's ~25 lightweight requests in
  // parallel — orders of magnitude less wire traffic + faster than
  // the scan.
  const clientList = (data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    aliases: string[] | null;
  }>;
  const counts = await Promise.all(
    clientList.map(async (c) => {
      const { count } = await admin
        .from("threads")
        .select("id", { count: "exact", head: true })
        .eq("client_id", c.id);
      return [c.id, count ?? 0] as const;
    }),
  );
  const byId = new Map<string, number>(counts);

  const rows = clientList.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    aliases: c.aliases ?? [],
    thread_count: byId.get(c.id) ?? 0,
    is_system: c.slug === "unknown",
  }));
  return NextResponse.json({ ok: true, clients: rows });
}

export async function POST(request: Request) {
  // requireSession gives both the user AND the active workspace so we
  // can auto-create the matching sidebar list below.
  const session = await requireSession();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminSupabase();
  const slug = toSlug(parsed.data.name);
  // Portal columns are only written/selected when the Client Portals
  // feature is live — until then migration 0016 may not be applied, so
  // referencing portal_token would break client creation.
  const insertRow: Record<string, unknown> = {
    name: parsed.data.name,
    slug,
    aliases: parsed.data.aliases ?? [],
  };
  if (CLIENT_PORTALS_ENABLED) {
    // Auto-generate an unguessable portal token: readable slug prefix +
    // 10 random hex chars.
    insertRow.portal_token = `${slug}-${randomHex(10)}`;
    insertRow.portal_enabled = true;
  }
  const { data, error } = await admin
    .from("clients")
    .insert(insertRow)
    .select("id, name, slug, aliases")
    .single();
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  _invalidateClientCache();

  // Re-tag any "Unknown" threads whose campaign_name matches the new
  // client (canonical name OR any alias). One small batch query —
  // doesn't fire on every webhook, only on this admin write.
  if (data) {
    await retagUnknownThreads(admin, data.id);
    // Sidebar list <-> client binding. Without this, the new client
    // exists in the catalog but has no sidebar surface — replies still
    // route via deriveClientIdFromCampaign, but the operator has no
    // list to click into. The unique partial index on
    // (workspace_id, client_id) makes this idempotent.
    await ensureListForClient(admin, {
      workspaceId: session.activeWorkspace.id,
      ownerUserId: session.user.id,
      clientId: data.id,
      clientName: data.name,
    });
  }

  return NextResponse.json({ ok: true, client: data });
}

// Idempotent: ensures a `lists` row exists for the given client_id in
// this workspace. Re-runs are safe thanks to the
// `lists_workspace_client_unique` partial unique index — onConflict
// turns the second call into a no-op.
async function ensureListForClient(
  admin: ReturnType<typeof createAdminSupabase>,
  args: {
    workspaceId: string;
    ownerUserId: string;
    clientId: string;
    clientName: string;
  },
): Promise<void> {
  const { data: maxRow } = await admin
    .from("lists")
    .select("sort_order")
    .eq("workspace_id", args.workspaceId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | null) ?? -1) + 1;
  await admin
    .from("lists")
    .upsert(
      {
        workspace_id: args.workspaceId,
        owner_user_id: args.ownerUserId,
        client_id: args.clientId,
        name: args.clientName,
        sort_order: nextOrder,
        shared: true,
      },
      { onConflict: "workspace_id,client_id", ignoreDuplicates: true },
    );
}

// Reusable: confirms there's a signed-in user. Returns an error
// response or the user object. Single-tenant: all members can manage
// clients (no per-role check beyond authenticated).
//
// Uses getUser() (not getSession()) so the JWT is actually verified
// against Supabase's auth server — getSession() reads the cookie
// without verification and triggers Supabase JS's security warning.
export async function requireAuthedUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  return { user };
}

// Walk every thread currently tagged "Unknown" and re-derive against the
// freshly-inserted/updated client. The derive helper hits the in-memory
// cache (we just invalidated it). At ~tens of threads this is cheap.
export async function retagUnknownThreads(
  admin: ReturnType<typeof createAdminSupabase>,
  _changedClientId: string,
): Promise<void> {
  const { data: unknown } = await admin
    .from("clients")
    .select("id")
    .eq("slug", "unknown")
    .maybeSingle();
  if (!unknown?.id) return;
  const { data: rows } = await admin
    .from("threads")
    .select("id, campaign_name")
    .eq("client_id", unknown.id)
    .not("campaign_name", "is", null);
  for (const t of rows ?? []) {
    const newClientId = await deriveClientIdFromCampaign(t.campaign_name as string);
    if (newClientId && newClientId !== unknown.id) {
      await admin
        .from("threads")
        .update({ client_id: newClientId })
        .eq("id", t.id);
    }
  }
}
