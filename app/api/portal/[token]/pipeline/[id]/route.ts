import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { notifyIntroduction } from "@/lib/webhooks/n8n-introduction";
import { pushPipelineEntryToFub } from "@/lib/integrations/push-pipeline-entry";

// PATCH /api/portal/[token]/pipeline/[id]
// DELETE /api/portal/[token]/pipeline/[id]
//
// The token IS the credential. We resolve it to a client_id and only
// permit reads / writes on pipeline rows that belong to that client.
// The portal expansion lets the client edit identity fields too
// (manual leads), so the schema accepts more than just stage moves.

export const dynamic = "force-dynamic";

const STAGES = [
  "introduction",
  "phone_screen_scheduled",
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
  lead_name: z.string().max(200).nullable().optional(),
  lead_email: z.string().email().max(200).nullable().optional(),
  lead_phone: z.string().max(80).nullable().optional(),
  current_brokerage: z.string().max(200).nullable().optional(),
  agent_profile_url: z.string().max(500).nullable().optional(),
  introduced_at: z.string().datetime().nullable().optional(),
  // Recruiter ownership — points at a client_team_members row.
  // null clears the assignment. FK is ON DELETE SET NULL so a deleted
  // team member unassigns automatically.
  assigned_team_member_id: z.string().uuid().nullable().optional(),
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
    .select("id, stage, fub_pushed_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  // Stage → Introduction is a meaningful event for two downstream
  // listeners. Both run inside `after(...)` so the user's request
  // returns immediately and neither integration can break the other.
  if (data.stage === "introduction") {
    const entryId = data.id as string;
    // 1. Notify the n8n webhook (every introduction, no dedup —
    //    that's the operator's contract with n8n).
    after(() => notifyIntroduction([entryId], "portal_stage_change"));
    // 2. Push to the client's Follow Up Boss account, if connected
    //    AND we haven't already pushed this entry. Failures land on
    //    fub_last_error inside the helper, never throw out here.
    if (!data.fub_pushed_at && client.fub_api_key_set) {
      const clientId = client.id;
      after(async () => {
        try {
          await pushPipelineEntryToFub(clientId, entryId);
        } catch (err) {
          console.error("[fub] auto-push failed", err);
        }
      });
    }
  }

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
    .from("client_pipeline_entries")
    .delete()
    .eq("id", id)
    .eq("client_id", client.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
