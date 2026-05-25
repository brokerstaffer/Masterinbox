import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// POST /api/portal/[token]/team — add a team member to the
// notification roster. (No transactional email is sent yet — see the
// follow-up note in the plan.)

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  title: z.string().trim().max(120).nullable().optional(),
  receives: z.enum(["intro", "digest", "admin"]).default("intro"),
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
  const { name, email, title, receives } = parsed.data;

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("client_team_members")
    .insert({
      client_id: client.id,
      name,
      email,
      title: title ?? null,
      receives,
      active: true,
    })
    .select("id")
    .single();
  if (error) {
    // Friendlier message for the unique (client_id, email) violation.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Someone with that email is already on the team." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}
