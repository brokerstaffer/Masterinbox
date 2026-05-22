import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createInstantlyClient, InstantlyError } from "@/lib/instantly/client";

// GET /api/threads/[threadId]/subsequence-status
//
// Reports whether this thread's lead is CURRENTLY sitting in an Instantly
// subsequence — so the ProspectPanel can show it and the user doesn't
// re-add a lead that's already in one. Instantly-only; other providers
// just return inSubsequence:false.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;

  const userClient = await createServerSupabase();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: visible } = await userClient
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .maybeSingle();
  if (!visible) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const admin = createAdminSupabase();
  const { data: thread } = await admin
    .from("threads")
    .select("id, source_provider, campaign_id, lead_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (thread.source_provider !== "instantly" || !thread.lead_id) {
    return NextResponse.json({ ok: true, inSubsequence: false });
  }

  const { data: lead } = await admin
    .from("leads")
    .select("email")
    .eq("id", thread.lead_id)
    .maybeSingle();
  const email = (lead?.email as string | null)?.trim();
  if (!email) {
    return NextResponse.json({ ok: true, inSubsequence: false });
  }

  try {
    const client = createInstantlyClient();
    const res = await client.findLeadByEmail(email);
    const instLead =
      (res.items ?? []).find(
        (l) => (l.email ?? "").toLowerCase() === email.toLowerCase(),
      ) ?? res.items?.[0];

    const subId = instLead?.subsequence_id ?? null;
    if (!subId) {
      return NextResponse.json({ ok: true, inSubsequence: false });
    }

    // Resolve the subsequence name from the campaign's subsequence list.
    // Best-effort — the indicator still shows without a name.
    let name: string | null = null;
    if (thread.campaign_id) {
      try {
        const subs = await client.listSubsequences(thread.campaign_id);
        name = (subs.items ?? []).find((s) => s.id === subId)?.name ?? null;
      } catch {
        // name is optional
      }
    }

    return NextResponse.json({
      ok: true,
      inSubsequence: true,
      subsequenceId: subId,
      name,
      addedAt: instLead?.timestamp_added_subsequence ?? null,
    });
  } catch (err) {
    if (err instanceof InstantlyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "lookup failed" },
      { status: 502 },
    );
  }
}
