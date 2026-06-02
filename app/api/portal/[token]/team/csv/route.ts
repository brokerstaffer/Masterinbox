import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// POST /api/portal/[token]/team/csv — bulk-import team-roster rows
// from the portal's CSV dialog.
//
// Mirrors the Agents CSV pattern: ONE batched upsert (idempotent on
// (client_id, email) thanks to migration 0042), no per-row network
// hops, instant UI. Team has no provider sync to fan out — adding a
// team member is purely local storage for warm-intro addressing.
//
// Email is required by the row schema (matches the single-row POST
// route — team is no longer a blocklist, it's an addressing list,
// and an entry without an email can't be addressed).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  title: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});

const schema = z.object({
  rows: z.array(rowSchema).min(1).max(5000),
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

  // Lowercase + dedup within the batch by email — the (client_id,
  // email) unique index treats them case-insensitively (email is a
  // citext column) but normalising up front keeps the round-trip
  // payload tidy and avoids relying on citext's exact behavior.
  const seen = new Set<string>();
  const rows = parsed.data.rows
    .map((r) => ({ ...r, email: r.email.toLowerCase() }))
    .filter((r) => {
      if (seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    });

  const insertRows = rows.map((r) => ({
    client_id: client.id,
    name: r.name,
    email: r.email,
    title: r.title ?? null,
    phone: r.phone ?? null,
    active: true,
  }));

  const { data: inserted, error } = await admin
    .from("client_team_members")
    .upsert(insertRows, {
      onConflict: "client_id,email",
      ignoreDuplicates: true,
    })
    .select("id, email");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    inserted: inserted?.length ?? 0,
  });
}
