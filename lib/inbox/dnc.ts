import { createAdminSupabase } from "@/lib/supabase/admin";
import { createEmailBisonClient } from "@/lib/emailbison/client";
import { createInstantlyClient } from "@/lib/instantly/client";

// "Do Not Contact" — pushes a thread's lead onto the source platform's
// blocklist so the sequencer stops emailing them. Wired to the "Hostile"
// label: whenever that label lands on a thread (AI labeler OR a manual
// add), the lead is auto-blacklisted.
//
// EmailBison  → POST /api/blacklisted-emails  { email }
// Instantly   → POST /block-lists-entries     { bl_value: email }
//
// Errors are swallowed and logged — a blocklist hiccup must never break
// labeling or a webhook ack.

export async function markThreadLeadDoNotContact(threadId: string): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { data: thread } = await admin
      .from("threads")
      .select("id, source_provider, lead_id, channel_id")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread?.lead_id) return;

    const { data: lead } = await admin
      .from("leads")
      .select("email")
      .eq("id", thread.lead_id)
      .maybeSingle();
    const email = (lead?.email as string | null)?.trim();
    if (!email) return;

    if (thread.source_provider === "emailbison") {
      const eb = createEmailBisonClient();
      // The blacklist is team-scoped — switch into the thread's team
      // first so the address is blocked in the right place.
      if (thread.channel_id) {
        const { data: ch } = await admin
          .from("channels")
          .select("emailbison_team_id")
          .eq("id", thread.channel_id)
          .maybeSingle();
        const teamId = ch?.emailbison_team_id as number | null;
        if (teamId) await eb.switchWorkspace(teamId);
      }
      await eb.blacklistEmail(email);
      console.log(`[dnc] blacklisted ${email} on EmailBison`);
    } else if (thread.source_provider === "instantly") {
      const inst = createInstantlyClient();
      await inst.blockEmail(email);
      console.log(`[dnc] blocked ${email} on Instantly`);
    }
  } catch (err) {
    console.error("[dnc] markThreadLeadDoNotContact failed", err);
  }
}

// Case-insensitive check used by the label hooks.
export function isHostileLabel(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "hostile";
}
