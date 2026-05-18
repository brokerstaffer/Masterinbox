import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

// Lightweight thread search. Filters by lead name / email / company OR
// thread subject. Returns up to 10 results — designed for the top-bar
// dropdown, not a full search results page.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const supabase = await createServerSupabase();
  const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
  const like = `%${escaped}%`;

  // Two-pass search so we can union matches on the joined leads table with
  // matches on the thread's subject. PostgREST's `.or` doesn't span joins.
  const [byLead, bySubject] = await Promise.all([
    supabase
      .from("threads")
      .select(
        `id, subject, last_message_at,
         leads:lead_id!inner(full_name, email, company)`,
      )
      .eq("workspace_id", session.activeWorkspace.id)
      .or(
        `full_name.ilike.${like},email.ilike.${like},company.ilike.${like}`,
        { foreignTable: "leads" },
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("threads")
      .select(
        `id, subject, last_message_at,
         leads:lead_id(full_name, email, company)`,
      )
      .eq("workspace_id", session.activeWorkspace.id)
      .ilike("subject", like)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10),
  ]);

  const seen = new Set<string>();
  const results: Array<{
    id: string;
    subject: string | null;
    lead_full_name: string | null;
    lead_email: string | null;
    lead_company: string | null;
    last_message_at: string | null;
  }> = [];
  for (const row of [...(byLead.data ?? []), ...(bySubject.data ?? [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    results.push({
      id: row.id,
      subject: row.subject,
      lead_full_name: lead?.full_name ?? null,
      lead_email: lead?.email ?? null,
      lead_company: lead?.company ?? null,
      last_message_at: row.last_message_at,
    });
    if (results.length >= 10) break;
  }

  return NextResponse.json({ results });
}
