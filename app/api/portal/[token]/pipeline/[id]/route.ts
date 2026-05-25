import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// PATCH /api/portal/[token]/pipeline/[id]
// Body: { stage?, needs_replacement?, notes? }
//
// The token IS the credential. We resolve it to a client_id and only
// permit updates to pipeline rows that belong to that client.

export const dynamic = "force-dynamic";

const STAGES = [
  "introduction",
  "phone_screen",
  "interview",
  "hired",
  "keep_warm",
  "we_they_rejected",
  "no_show",
] as const;

const schema = z.object({
  stage: z.enum(STAGES).optional(),
  needs_replacement: z.boolean().optional(),
  notes: z.string().max(20_000).nullable().optional(),
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

  const parsed = schema.safeParse(await request.json().catch(() => null));
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
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  const { data, error } = await admin
    .from("client_pipeline_entries")
    .update(patch)
    .eq("id", id)
    .eq("client_id", client.id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
