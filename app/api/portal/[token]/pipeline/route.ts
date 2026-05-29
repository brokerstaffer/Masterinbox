import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// POST /api/portal/[token]/pipeline — manually create a pipeline entry
// from the client portal. Used when the client wants to log an intro
// that didn't come through the inbox (cold reach-out, networking,
// etc.). The row has no thread_id and no external_intros backing.

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

const createSchema = z.object({
  lead_name: z.string().max(200).nullable().optional(),
  lead_email: z.string().email().max(200).nullable().optional(),
  lead_phone: z.string().max(80).nullable().optional(),
  current_brokerage: z.string().max(200).nullable().optional(),
  agent_profile_url: z.string().max(500).nullable().optional(),
  introduced_at: z.string().datetime().nullable().optional(),
  stage: z.enum(STAGES).optional(),
});

const bulkSchema = z.object({
  action: z.enum(["delete", "stage"]),
  ids: z.array(z.string().uuid()).min(1).max(500),
  stage: z.enum(STAGES).optional(),
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

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminSupabase();
  const row = {
    client_id: client.id,
    stage: parsed.data.stage ?? "introduction",
    needs_replacement: false,
    lead_name: parsed.data.lead_name ?? null,
    lead_email: parsed.data.lead_email ?? null,
    lead_phone: parsed.data.lead_phone ?? null,
    current_brokerage: parsed.data.current_brokerage ?? null,
    agent_profile_url: parsed.data.agent_profile_url ?? null,
    introduced_at: parsed.data.introduced_at ?? new Date().toISOString(),
  };
  const { data, error } = await admin
    .from("client_pipeline_entries")
    .insert(row)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data.id });
}

// PATCH /api/portal/[token]/pipeline — bulk actions. Body chooses
// between delete and stage move, with `ids` listing affected entries.
// Each id is scoped to this client so cross-client tampering is moot.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }
  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const admin = createAdminSupabase();
  if (parsed.data.action === "delete") {
    const { error } = await admin
      .from("client_pipeline_entries")
      .delete()
      .eq("client_id", client.id)
      .in("id", parsed.data.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "stage") {
    if (!parsed.data.stage) {
      return NextResponse.json({ error: "stage required" }, { status: 400 });
    }
    const { error } = await admin
      .from("client_pipeline_entries")
      .update({ stage: parsed.data.stage, updated_at: new Date().toISOString() })
      .eq("client_id", client.id)
      .in("id", parsed.data.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
