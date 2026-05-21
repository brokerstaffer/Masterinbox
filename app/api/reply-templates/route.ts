import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

// GET  /api/reply-templates  → list templates for the workspace
// POST /api/reply-templates  → create a template { name, body }

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  body: z.string().max(8000).default(""),
});

export async function GET() {
  const session = await requireSession();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("reply_templates")
    .select("id, name, body, sort_order")
    .eq("workspace_id", session.activeWorkspace.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const session = await requireSession();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  // New templates land at the end of the current ordering.
  const { data: maxRow } = await supabase
    .from("reply_templates")
    .select("sort_order")
    .eq("workspace_id", session.activeWorkspace.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("reply_templates")
    .insert({
      workspace_id: session.activeWorkspace.id,
      name: parsed.data.name,
      body: parsed.data.body,
      sort_order: nextOrder,
    })
    .select("id, name, body, sort_order")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ template: data });
}
