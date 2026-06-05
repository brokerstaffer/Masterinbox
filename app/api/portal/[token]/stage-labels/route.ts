import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import {
  STAGE_LABEL_MAX_LEN,
  STAGE_ORDER,
  type PipelineStage,
} from "@/lib/portals/portal-data";

// PATCH /api/portal/[token]/stage-labels
//
// Per-client custom names for the pipeline_stage enum. Token-in-path
// is the credential (same as every other /api/portal/<token>/* route).
// The body's `overrides` map can include any subset of the known
// stages — unknown keys are rejected so a stale client can't smuggle
// in junk that lingers in the jsonb. Empty / whitespace values are
// dropped on the server so the stored shape is always either the
// override OR nothing for that stage.

export const dynamic = "force-dynamic";

const STAGES = STAGE_ORDER as readonly PipelineStage[];

const bodySchema = z.object({
  overrides: z.record(z.string(), z.string()),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Whitelist + sanitize: only known stages, trimmed, capped to the
  // shared max length. Drop empties so the stored JSON only contains
  // actual overrides.
  const allowed = new Set<string>(STAGES);
  const cleaned: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed.data.overrides)) {
    if (!allowed.has(key)) {
      return NextResponse.json(
        { error: `Unknown stage: ${key}` },
        { status: 400 },
      );
    }
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) continue;
    cleaned[key] = trimmed.slice(0, STAGE_LABEL_MAX_LEN);
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("clients")
    .update({
      stage_label_overrides: cleaned,
      updated_at: new Date().toISOString(),
    })
    .eq("id", client.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, overrides: cleaned });
}
