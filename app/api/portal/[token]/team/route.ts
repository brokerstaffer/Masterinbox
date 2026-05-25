import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { enforceBlocklist } from "@/lib/portals/enforce-blocklist";

// POST /api/portal/[token]/team — add a team member to the
// notification roster. Their email is also pushed to the Instantly +
// EmailBison blocklists, mirroring the Your Agents flow — anyone on
// the brokerage's own team should never receive cold outreach.

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  title: z.string().trim().max(120).nullable().optional(),
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
  const { name, email, title } = parsed.data;

  const push = await enforceBlocklist(email);

  const admin = createAdminSupabase();
  // `receives` is no longer collected from the UI (notification
  // delivery isn't wired up); the DB column keeps its default value
  // until/unless that feature returns.
  const { data, error } = await admin
    .from("client_team_members")
    .insert({
      client_id: client.id,
      name,
      email,
      title: title ?? null,
      active: true,
      pushed_to_instantly: push.pushedInstantly,
      pushed_to_emailbison: push.pushedEmailBison,
      push_error: push.error,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Someone with that email is already on the team." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    id: data.id,
    pushedInstantly: push.pushedInstantly,
    pushedEmailBison: push.pushedEmailBison,
  });
}
