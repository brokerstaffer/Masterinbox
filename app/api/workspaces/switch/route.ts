import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/auth/workspace";

// Switches the active workspace by setting our cookie. Verifies the caller is
// a member of the target workspace via RLS.

const schema = z.object({ workspace_id: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", parsed.data.workspace_id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Not a member of that workspace" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(WORKSPACE_COOKIE, parsed.data.workspace_id, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
