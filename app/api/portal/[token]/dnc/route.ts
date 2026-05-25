import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { enforceBlocklist } from "@/lib/portals/enforce-blocklist";

// POST /api/portal/[token]/dnc — add a DNC entry. If an email is
// supplied, push to Instantly + EmailBison blocklists immediately.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  kind: z.enum(["agent", "company"]).default("agent"),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  brokerage: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { kind, name, email, phone, brokerage, notes } = parsed.data;

  const admin = createAdminSupabase();

  // Enforce blocklist FIRST (when an email is present) so the row's
  // push_* flags reflect reality on insert. The provider calls take
  // ~1-2s each — acceptable for an explicit "Add" click.
  let pushedInstantly = false;
  let pushedEmailBison = false;
  let pushError: string | null = null;
  if (email) {
    const result = await enforceBlocklist(email);
    pushedInstantly = result.pushedInstantly;
    pushedEmailBison = result.pushedEmailBison;
    pushError = result.error;
  }

  const { data, error } = await admin
    .from("client_dnc_entries")
    .insert({
      client_id: client.id,
      kind,
      name,
      email: email ?? null,
      phone: phone ?? null,
      brokerage: brokerage ?? null,
      notes: notes ?? null,
      added_by: "client",
      pushed_to_instantly: pushedInstantly,
      pushed_to_emailbison: pushedEmailBison,
      push_error: pushError,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    id: data.id,
    pushedInstantly,
    pushedEmailBison,
    pushError,
  });
}
