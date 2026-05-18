import { z } from "zod";
import { requireSession } from "@/lib/auth/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  thread_ids: z.array(z.string().uuid()).min(1).max(5000),
});

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid input" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createServerSupabase();
  const { data: threads, error } = await supabase
    .from("threads")
    .select(
      `id, subject, status, last_message_at, message_count,
       leads:lead_id(full_name, email, company, title),
       channels:channel_id(display_name, provider)`,
    )
    .in("id", parsed.data.thread_ids)
    .eq("workspace_id", session.activeWorkspace.id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = [
    "thread_id",
    "subject",
    "status",
    "last_message_at",
    "message_count",
    "lead_name",
    "lead_email",
    "company",
    "title",
    "channel",
  ];
  const lines = [headers.join(",")];

  for (const t of threads ?? []) {
    const lead = Array.isArray(t.leads) ? t.leads[0] : t.leads;
    const channel = Array.isArray(t.channels) ? t.channels[0] : t.channels;
    lines.push(
      [
        t.id,
        csvEscape(t.subject),
        csvEscape(t.status),
        csvEscape(t.last_message_at),
        csvEscape(t.message_count),
        csvEscape(lead?.full_name),
        csvEscape(lead?.email),
        csvEscape(lead?.company),
        csvEscape(lead?.title),
        csvEscape(channel?.display_name ?? channel?.provider),
      ].join(","),
    );
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="threads-${Date.now()}.csv"`,
    },
  });
}
