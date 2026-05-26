import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { enforceBlocklist } from "@/lib/portals/enforce-blocklist";

// PATCH / DELETE /api/portal/[token]/dnc/[id]
//
// PATCH allows partial updates from the portal's Edit dialog. `kind`
// is intentionally NOT editable — agent vs company is a category-level
// distinction that's locked after creation. If the email changes to a
// new non-empty address we re-push it to Instantly + EmailBison. The
// previous email stays on the providers (same one-directional rule as
// DELETE).
//
// DELETE removes the row; provider blocklist entries stay in place
// (the client can un-block manually in those tools if needed).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  brokerage: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("client_dnc_entries")
    .select("email, kind")
    .eq("id", id)
    .eq("client_id", client.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });
  if (!current) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  // Brokerage only applies to agent kind; null it out on company rows
  // even if the caller sent a value.
  const incoming = { ...parsed.data };
  if (current.kind !== "agent" && "brokerage" in incoming) {
    incoming.brokerage = null;
  }

  const update: Record<string, unknown> = {
    ...incoming,
    updated_at: new Date().toISOString(),
  };

  const newEmail = parsed.data.email;
  const emailChanged =
    Object.prototype.hasOwnProperty.call(parsed.data, "email") &&
    newEmail &&
    newEmail !== current.email;
  if (emailChanged && newEmail) {
    const r = await enforceBlocklist(newEmail);
    update.pushed_to_instantly = r.pushedInstantly;
    update.pushed_to_emailbison = r.pushedEmailBison;
    update.push_error = r.error;
  }

  const { error } = await admin
    .from("client_dnc_entries")
    .update(update)
    .eq("id", id)
    .eq("client_id", client.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }
  const admin = createAdminSupabase();
  const { error } = await admin
    .from("client_dnc_entries")
    .delete()
    .eq("id", id)
    .eq("client_id", client.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
