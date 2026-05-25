import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// DELETE /api/portal/[token]/agents/[id] — removes the agent from the
// portal's list. The provider blocklist entries (if pushed earlier) are
// left in place — same one-directional rule as DNC.

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
    .from("client_agents")
    .delete()
    .eq("id", id)
    .eq("client_id", client.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
