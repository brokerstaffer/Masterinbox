import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  icon: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("lists")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", session.activeWorkspace.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await requireSession();
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("lists")
    .delete()
    .eq("id", id)
    .eq("workspace_id", session.activeWorkspace.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
