import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { backfillLabelsForWorkspace } from "@/lib/ai/run";

// Kicks off an AI-labeling pass over historical inbound messages in the
// current workspace. Runs synchronously — fine for a few hundred threads
// but should move to a background job once the volume grows.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await requireSession();
  try {
    const result = await backfillLabelsForWorkspace(session.activeWorkspace.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 },
    );
  }
}
