import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";
import { chunkedRun } from "@/lib/db/chunked-in";

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

  // Every server-side `.in("id"|"target_id"|"thread_id", thread_ids)`
  // call below funnels through chunkedRun so the URL it builds for
  // PostgREST stays under Node's 16 KB header cap regardless of how
  // many ids the client sends. The zod schema caps at 500; without
  // chunking that translates to a ~18.5 KB URL and silent failure.
  switch (data.action) {
    case "seen": {
      const results = await chunkedRun(data.thread_ids, (slice) =>
        supabase
          .from("threads")
          .update({ seen: data.seen })
          .in("id", slice)
          .eq("workspace_id", wsId),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "status": {
      const results = await chunkedRun(data.thread_ids, (slice) =>
        supabase
          .from("threads")
          .update({ status: data.status })
          .in("id", slice)
          .eq("workspace_id", wsId),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "delete": {
      // Soft delete — move to trash. We can wire hard-delete behind a flag later.
      const results = await chunkedRun(data.thread_ids, (slice) =>
        supabase
          .from("threads")
          .update({ status: "trash" })
          .in("id", slice)
          .eq("workspace_id", wsId),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "labels": {
      if (data.op === "add") {
        // Single-label-per-thread semantics (matches the single-thread
        // POST /api/threads/[id]/labels path) — wipe every existing
        // label assignment on the selected threads first, then upsert
        // the ones we're applying. Without this, bulk labeling
        // accumulated chips on top of whatever was already there and
        // operators reported the action as broken.
        //
        // The brief window where threads have zero labels is the same
        // trade-off the single-thread path makes — Supabase REST
        // doesn't support cross-statement transactions.
        const wipeResults = await chunkedRun(data.thread_ids, (slice) =>
          supabase
            .from("label_assignments")
            .delete()
            .eq("target_type", "thread")
            .in("target_id", slice),
        );
        const wipeFail = wipeResults.find((r) => r.error);
        if (wipeFail?.error) {
          return NextResponse.json({ error: wipeFail.error.message }, { status: 400 });
        }
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
        // Insert in row chunks rather than thread-id chunks — the
        // payload is in the POST body, not the URL, so the cap is
        // request body size (much larger), but we still split for
        // sane request times at 5k × 50 = 250k rows.
        const insertChunkSize = 500;
        for (let i = 0; i < rows.length; i += insertChunkSize) {
          const { error } = await supabase
            .from("label_assignments")
            .upsert(rows.slice(i, i + insertChunkSize), {
              onConflict: "label_id,target_type,target_id",
            });
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ ok: true });
      } else {
        const results = await chunkedRun(data.thread_ids, (slice) =>
          supabase
            .from("label_assignments")
            .delete()
            .eq("target_type", "thread")
            .in("target_id", slice)
            .in("label_id", data.label_ids),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 400 });
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
        // Upsert in row chunks; payload lives in POST body.
        const insertChunkSize = 500;
        for (let i = 0; i < rows.length; i += insertChunkSize) {
          const { error } = await supabase
            .from("thread_list_items")
            .upsert(rows.slice(i, i + insertChunkSize), {
              onConflict: "list_id,thread_id",
            });
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ ok: true });
      } else {
        const results = await chunkedRun(data.thread_ids, (slice) =>
          supabase
            .from("thread_list_items")
            .delete()
            .eq("list_id", data.list_id)
            .in("thread_id", slice),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
    }
  }
}
