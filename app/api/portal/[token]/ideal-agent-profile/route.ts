import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { clientHasFeature } from "@/lib/portals/feature-flags";

// PATCH /api/portal/[token]/ideal-agent-profile
//
// Persists the brokerage's "Define Your Ideal Agent Profile"
// answers as a single JSONB row write. Feature-gated behind
// clients.feature_flags.ideal_agent_profile so a real client that
// guesses the URL gets a 404 the same way the page route does.
//
// The schema accepts every key as optional so the form can save
// partial answers (the client may fill MLS chips today, sales
// volume tomorrow). Missing keys are omitted from the persisted
// jsonb, not stored as null — keeps the document compact.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STRING_MAX = 200;

const schema = z
  .object({
    annual_sales_volume: z.string().trim().max(STRING_MAX).nullable().optional(),
    closed_transactions: z.string().trim().max(STRING_MAX).nullable().optional(),
    years_experience: z.string().trim().max(STRING_MAX).nullable().optional(),
    mls_affiliations: z
      .array(z.string().trim().min(1).max(STRING_MAX))
      .max(50)
      .optional(),
    target_markets: z
      .array(z.string().trim().min(1).max(STRING_MAX))
      .max(50)
      .optional(),
    additional_criteria: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }
  if (!clientHasFeature(client, "ideal_agent_profile")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Strip undefined keys so the persisted document only carries
  // what the form actually sent. Empty arrays + nulls are kept
  // (a deliberate "the answer here is none / unset" signal).
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) payload[k] = v;
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("clients")
    .update({ ideal_agent_profile: payload })
    .eq("id", client.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
