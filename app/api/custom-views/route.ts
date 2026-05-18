import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PRESETS = [
  "needs_reply",
  "follow_up",
  "engaged",
  "meeting_pipeline",
  "all_email",
  "dnc",
  "custom",
] as const;

const createSchema = z.object({
  name: z.string().min(1).max(80),
  icon: z.string().optional(),
  filter_json: z
    .object({
      preset: z.enum(PRESETS).optional(),
      step: z.number().int().optional(),
      labels: z.array(z.string()).optional(),
      channels: z.array(z.string()).optional(),
    })
    .passthrough(),
});

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const { data: maxRow } = await supabase
    .from("custom_views")
    .select("sort_order")
    .eq("workspace_id", session.activeWorkspace.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("custom_views")
    .insert({
      workspace_id: session.activeWorkspace.id,
      owner_user_id: session.user.id,
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      filter_json: parsed.data.filter_json,
      sort_order: nextOrder,
      shared: true,
      is_system: false,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data.id });
}
