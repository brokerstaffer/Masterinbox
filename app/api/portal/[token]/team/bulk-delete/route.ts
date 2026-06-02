import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// POST /api/portal/[token]/team/bulk-delete
// Body: { ids: string[] }
//
// Removes multiple team members from the intro-notification roster
// in one request. Mirrors the Agents bulk-delete shape so the UI
// chunking logic is identical (300 ids per request, sequential).
// Each id is scoped to the portal's client_id — sending an id that
// belongs to a different client is a no-op (the row simply isn't
// matched).

export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
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
  const admin = createAdminSupabase();
  const { error, count } = await admin
    .from("client_team_members")
    .delete({ count: "exact" })
    .eq("client_id", client.id)
    .in("id", parsed.data.ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
