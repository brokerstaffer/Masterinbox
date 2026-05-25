import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// DELETE /api/portal/[token]/dnc/[id]
//
// Removes the row from our DNC list. We do NOT call the provider remove
// endpoints — once blocked on Instantly/EmailBison, the address stays
// blocked there (the client can un-block manually in those tools if
// needed). This keeps the portal action one-directional and safe.

export const dynamic = "force-dynamic";

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
