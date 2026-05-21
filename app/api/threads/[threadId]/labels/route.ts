import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";
import { isHostileLabel, markThreadLeadDoNotContact } from "@/lib/inbox/dnc";

export const dynamic = "force-dynamic";

const postSchema = z.object({ label_id: z.string().uuid() });
const deleteSchema = z.object({ label_id: z.string().uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("label_assignments").upsert(
    {
      workspace_id: session.activeWorkspace.id,
      label_id: parsed.data.label_id,
      target_type: "thread",
      target_id: threadId,
      assigned_by: "user",
      assigned_user_id: session.user.id,
    },
    { onConflict: "label_id,target_type,target_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Hostile → auto Do-Not-Contact. Look up the label name; if it's
  // "Hostile", blacklist the lead on the source platform.
  const { data: label } = await supabase
    .from("labels")
    .select("name")
    .eq("id", parsed.data.label_id)
    .maybeSingle();
  if (isHostileLabel(label?.name as string | null)) {
    await markThreadLeadDoNotContact(threadId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("label_assignments")
    .delete()
    .eq("label_id", parsed.data.label_id)
    .eq("target_type", "thread")
    .eq("target_id", threadId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
