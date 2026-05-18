import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// One endpoint that dispatches across the bulk-toolbar actions. Keeping it
// in one route avoids a fan-out of POST endpoints for closely-related ops.
//
// Body shape per action:
//   seen:   { thread_ids: [], action: "seen", seen: boolean }
//   status: { thread_ids: [], action: "status", status: "open" | "archived" | "trash" | "spam" }
//   labels: { thread_ids: [], action: "labels", label_ids: [], op: "add" | "remove" }
//   list:   { thread_ids: [], action: "list", list_id: uuid, op: "add" | "remove" }
//   delete: { thread_ids: [], action: "delete" }

const idsSchema = z.array(z.string().uuid()).min(1).max(500);

const schemas = {
  seen: z.object({
    action: z.literal("seen"),
    thread_ids: idsSchema,
    seen: z.boolean(),
  }),
  status: z.object({
    action: z.literal("status"),
    thread_ids: idsSchema,
    status: z.enum(["open", "archived", "trash", "spam", "reminder"]),
  }),
  labels: z.object({
    action: z.literal("labels"),
    thread_ids: idsSchema,
    label_ids: z.array(z.string().uuid()).min(1).max(50),
    op: z.enum(["add", "remove"]),
  }),
  list: z.object({
    action: z.literal("list"),
    thread_ids: idsSchema,
    list_id: z.string().uuid(),
    op: z.enum(["add", "remove"]),
  }),
  delete: z.object({
    action: z.literal("delete"),
    thread_ids: idsSchema,
  }),
};

const dispatcher = z.discriminatedUnion("action", [
  schemas.seen,
  schemas.status,
  schemas.labels,
  schemas.list,
  schemas.delete,
]);

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = dispatcher.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const wsId = session.activeWorkspace.id;
  const data = parsed.data;

  switch (data.action) {
    case "seen": {
      const { error } = await supabase
        .from("threads")
        .update({ seen: data.seen })
        .in("id", data.thread_ids)
        .eq("workspace_id", wsId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "status": {
      const { error } = await supabase
        .from("threads")
        .update({ status: data.status })
        .in("id", data.thread_ids)
        .eq("workspace_id", wsId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "delete": {
      // Soft delete — move to trash. We can wire hard-delete behind a flag later.
      const { error } = await supabase
        .from("threads")
        .update({ status: "trash" })
        .in("id", data.thread_ids)
        .eq("workspace_id", wsId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "labels": {
      if (data.op === "add") {
        // Build a cross-product (thread × label) and upsert with the unique
        // constraint on (label_id, target_type, target_id).
        const rows = data.thread_ids.flatMap((tid) =>
          data.label_ids.map((lid) => ({
            workspace_id: wsId,
            label_id: lid,
            target_type: "thread" as const,
            target_id: tid,
            assigned_by: "user" as const,
            assigned_user_id: session.user.id,
          })),
        );
        const { error } = await supabase
          .from("label_assignments")
          .upsert(rows, { onConflict: "label_id,target_type,target_id" });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      } else {
        const { error } = await supabase
          .from("label_assignments")
          .delete()
          .eq("target_type", "thread")
          .in("target_id", data.thread_ids)
          .in("label_id", data.label_ids);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
    }
    case "list": {
      if (data.op === "add") {
        const rows = data.thread_ids.map((tid) => ({
          list_id: data.list_id,
          thread_id: tid,
          workspace_id: wsId,
          added_by: session.user.id,
        }));
        const { error } = await supabase
          .from("thread_list_items")
          .upsert(rows, { onConflict: "list_id,thread_id" });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      } else {
        const { error } = await supabase
          .from("thread_list_items")
          .delete()
          .eq("list_id", data.list_id)
          .in("thread_id", data.thread_ids);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
    }
  }
}
