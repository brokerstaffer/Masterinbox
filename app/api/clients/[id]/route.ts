import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { _invalidateClientCache } from "@/lib/clients/derive";
import { CLIENT_PORTALS_ENABLED } from "@/lib/portals/flag";
import { requireAuthedUser, retagUnknownThreads } from "../route";

// PATCH  /api/clients/[id]   -> rename + edit aliases
// DELETE /api/clients/[id]   -> delete the client (threads referencing it
//                               keep client_id NULL via the FK's ON DELETE
//                               SET NULL — they'll re-tag next webhook).
//
// The "Unknown" row (slug='unknown') is protected: rename/delete on it
// returns 400 because it's the system fallback target.

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  // Client portal access. portal_token is the secret path segment in
  // /portal/<token> — min 8 chars + URL-safe so it can't be trivially
  // guessed. portal_enabled toggles the portal without losing the token.
  portal_token: z
    .string()
    .trim()
    .min(8, "Portal URL must be at least 8 characters")
    .max(120)
    .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, hyphens and underscores")
    .optional(),
  portal_enabled: z.boolean().optional(),
});

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "client";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthedUser();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("clients")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (existing.slug === "unknown" && parsed.data.name && parsed.data.name !== existing.name) {
    return NextResponse.json(
      { error: "The 'Unknown' fallback client can't be renamed." },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    update.name = parsed.data.name;
    update.slug = toSlug(parsed.data.name);
  }
  if (parsed.data.aliases !== undefined) {
    update.aliases = parsed.data.aliases;
  }
  // Portal fields are only honoured when the Client Portals feature is
  // live (migration 0016 may not be applied otherwise).
  if (CLIENT_PORTALS_ENABLED) {
    if (parsed.data.portal_token !== undefined) {
      if (existing.slug === "unknown") {
        return NextResponse.json(
          { error: "The 'Unknown' fallback client has no portal." },
          { status: 400 },
        );
      }
      update.portal_token = parsed.data.portal_token;
    }
    if (parsed.data.portal_enabled !== undefined) {
      update.portal_enabled = parsed.data.portal_enabled;
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("clients")
    .update(update)
    .eq("id", id)
    .select("id, name, slug, aliases")
    .single();
  if (error) {
    // 23505 = unique violation (duplicate name OR duplicate portal_token).
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "That portal URL (or name) is already taken — pick another."
            : error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  _invalidateClientCache();
  // Aliases changed → existing "Unknown" threads might now match.
  if (parsed.data.aliases !== undefined || parsed.data.name !== undefined) {
    await retagUnknownThreads(admin, id);
  }
  return NextResponse.json({ ok: true, client: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthedUser();
  if ("error" in auth) return auth.error;
  const { id } = await context.params;

  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("clients")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (existing.slug === "unknown") {
    return NextResponse.json(
      { error: "The 'Unknown' fallback client can't be deleted." },
      { status: 400 },
    );
  }

  // Threads pointing at this client lose their tag (FK is ON DELETE SET
  // NULL). The next webhook on each thread re-tags it; or the user can
  // manually re-classify later.
  const { error } = await admin.from("clients").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  _invalidateClientCache();
  return NextResponse.json({ ok: true });
}
