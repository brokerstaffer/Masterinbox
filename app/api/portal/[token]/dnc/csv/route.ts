import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";
import { enforceBlocklist } from "@/lib/portals/enforce-blocklist";

// POST /api/portal/[token]/dnc/csv — bulk-import parsed DNC rows from
// the portal's CSV dialog. Same shape as /agents/csv: browser parses,
// this route validates and writes, blocklist push is best-effort per
// row with a light throttle.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const rowSchema = z.object({
  kind: z.enum(["agent", "company"]),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  brokerage: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
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
  const seen = new Set<string>();
  const rows = parsed.data.rows.filter((r) => {
    if (!r.email) return true;
    const k = r.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let inserted = 0;
  let pushedCount = 0;
  const errors: string[] = [];

  for (const r of rows) {
    let pushedInstantly = false;
    let pushedEmailBison = false;
    let pushError: string | null = null;
    if (r.email) {
      const result = await enforceBlocklist(r.email);
      pushedInstantly = result.pushedInstantly;
      pushedEmailBison = result.pushedEmailBison;
      pushError = result.error;
      if (pushedInstantly || pushedEmailBison) pushedCount += 1;
    }
    const { error } = await admin.from("client_dnc_entries").insert({
      client_id: client.id,
      kind: r.kind,
      name: r.name,
      email: r.email ?? null,
      phone: r.phone ?? null,
      brokerage: r.brokerage ?? null,
      notes: r.notes ?? null,
      added_by: "client",
      pushed_to_instantly: pushedInstantly,
      pushed_to_emailbison: pushedEmailBison,
      push_error: pushError,
    });
    if (error) {
      errors.push(`${r.email ?? r.name}: ${error.message}`);
    } else {
      inserted += 1;
    }
    if (r.email) await new Promise((res) => setTimeout(res, 250));
  }

  return NextResponse.json({
    ok: true,
    inserted,
    pushedCount,
    errors: errors.slice(0, 20),
  });
}
