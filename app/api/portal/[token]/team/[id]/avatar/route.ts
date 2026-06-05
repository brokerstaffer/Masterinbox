import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolvePortalClient } from "@/lib/portals/token";

// POST   /api/portal/[token]/team/[id]/avatar  — upload + assign
// DELETE /api/portal/[token]/team/[id]/avatar  — clear
//
// Profile picture for a team member shown in the portal Team list.
// Token-in-path is the credential, same as every other
// /api/portal/<token>/* route. The member id is then scoped to the
// resolved client so cross-client guessing surfaces nothing.
//
// Storage: bucket `team-avatars` (public read, service-role write
// only — see migration 0049). Object key:
//   {client_id}/{member_id}-{epoch}.{ext}
// The timestamp defeats CDN/browser caching when a member
// re-uploads; on overwrite the previous object is deleted so the
// bucket doesn't grow unbounded.

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await context.params;
  const client = await resolvePortalClient(token);
  if (!client) {
    return NextResponse.json({ error: "Portal not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "Missing file" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image too large (max 5MB)" },
      { status: 413 },
    );
  }
  const mime = file.type || "image/jpeg";
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json(
      { error: "Unsupported image type (use JPG, PNG, or WebP)" },
      { status: 415 },
    );
  }

  const admin = createAdminSupabase();

  // Confirm the member exists under this client and grab the
  // existing avatar so we can delete it after the new one lands.
  const { data: member } = await admin
    .from("client_team_members")
    .select("id, avatar_url")
    .eq("id", id)
    .eq("client_id", client.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const ext = MIME_TO_EXT[mime] ?? "jpg";
  const key = `${client.id}/${id}-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from("team-avatars")
    .upload(key, bytes, {
      contentType: mime,
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from("team-avatars").getPublicUrl(key);
  const publicUrl = pub.publicUrl;

  const { error: updateErr } = await admin
    .from("client_team_members")
    .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", client.id);
  if (updateErr) {
    // Best-effort cleanup so we don't leak the orphaned object.
    await admin.storage.from("team-avatars").remove([key]).catch(() => null);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Delete the previous avatar, if any. Fire-and-forget; a failure
  // here just leaves an orphan that we can sweep later.
  const previous = parseOurAvatarKey(member.avatar_url as string | null);
  if (previous && previous !== key) {
    admin.storage
      .from("team-avatars")
      .remove([previous])
      .catch(() => null);
  }

  return NextResponse.json({ ok: true, avatar_url: publicUrl });
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
  const { data: member } = await admin
    .from("client_team_members")
    .select("id, avatar_url")
    .eq("id", id)
    .eq("client_id", client.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { error: updateErr } = await admin
    .from("client_team_members")
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", client.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const previous = parseOurAvatarKey(member.avatar_url as string | null);
  if (previous) {
    await admin.storage.from("team-avatars").remove([previous]).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}

// Extract the storage key from a public URL we minted. Returns null
// for nulls or external URLs we shouldn't touch.
function parseOurAvatarKey(url: string | null): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/team-avatars/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}
