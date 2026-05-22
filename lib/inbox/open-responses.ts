import type { createServerSupabase } from "@/lib/supabase/server";

// "Open Responses" — a work-queue view that can't be expressed with the
// FilterBuilder's AND-ed rows because it's an OR of two conditions:
//
//   (a) tagged "Interested" AND NOT tagged "Meetings Booked"
//       — an open opportunity; stays in the queue (even after we reply)
//       until someone books the meeting.
//   (b) no labels at all — an untagged lead that needs manual tagging.
//
// Stored on a custom_views row as { preset: "open_responses" }; the
// membership logic lives here so loadThreads and loadViewCounts agree.

export const OPEN_RESPONSES_PRESET = "open_responses";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

// Pure membership test — given a thread's label state, is it an Open
// Response? Kept separate so the SQL-driven loader and the count pass
// share one definition.
export function isOpenResponse(args: {
  hasAnyLabel: boolean;
  hasInterested: boolean;
  hasMeetingsBooked: boolean;
}): boolean {
  if (!args.hasAnyLabel) return true; // untagged → needs manual tagging
  return args.hasInterested && !args.hasMeetingsBooked;
}

// Resolve the two label ids this view keys on, by name (workspace-scoped).
// Either may be null if the workspace hasn't got that label.
export async function resolveOpenResponseLabelIds(
  supabase: ServerSupabase,
  workspaceId: string,
): Promise<{ interested: string | null; meetingsBooked: string | null }> {
  const { data } = await supabase
    .from("labels")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .in("name", ["Interested", "Meetings Booked"]);
  let interested: string | null = null;
  let meetingsBooked: string | null = null;
  for (const row of data ?? []) {
    const r = row as { id: string; name: string };
    if (r.name === "Interested") interested = r.id;
    else if (r.name === "Meetings Booked") meetingsBooked = r.id;
  }
  return { interested, meetingsBooked };
}

// Every open thread id in the workspace that qualifies as an Open
// Response. Used by loadThreads to restrict the query via .in("id", …).
export async function openResponsesThreadIds(
  supabase: ServerSupabase,
  workspaceId: string,
): Promise<Set<string>> {
  const { interested, meetingsBooked } = await resolveOpenResponseLabelIds(
    supabase,
    workspaceId,
  );

  const { data: threadRows } = await supabase
    .from("threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .range(0, 49_999);
  const ids = (threadRows ?? []).map((t) => (t as { id: string }).id);
  if (ids.length === 0) return new Set();

  // thread_id → set of its label ids. Chunked IN() to keep each request
  // URL well under Node's ~16KB header cap — a UUID is ~37 chars, so 150
  // per chunk tops out around 5.5KB.
  const labelsByThread = new Map<string, Set<string>>();
  const CHUNK = 150;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: assignments } = await supabase
      .from("label_assignments")
      .select("label_id, target_id")
      .eq("workspace_id", workspaceId)
      .eq("target_type", "thread")
      .in("target_id", slice)
      .range(0, 49_999);
    for (const row of assignments ?? []) {
      const r = row as { label_id: string; target_id: string };
      const set = labelsByThread.get(r.target_id) ?? new Set<string>();
      set.add(r.label_id);
      labelsByThread.set(r.target_id, set);
    }
  }

  const result = new Set<string>();
  for (const id of ids) {
    const labels = labelsByThread.get(id);
    if (
      isOpenResponse({
        hasAnyLabel: Boolean(labels && labels.size > 0),
        hasInterested: Boolean(interested && labels?.has(interested)),
        hasMeetingsBooked: Boolean(meetingsBooked && labels?.has(meetingsBooked)),
      })
    ) {
      result.add(id);
    }
  }
  return result;
}
