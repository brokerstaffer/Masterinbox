import { createEmailBisonClient } from "@/lib/emailbison/client";
import { createInstantlyClient } from "@/lib/instantly/client";

// Pushes an email to Instantly and EmailBison blocklists. Used when a
// client adds an entry to their DNC list or their own-agent roster —
// either way the address should never receive outreach again.
//
// This is the per-email counterpart to lib/inbox/dnc.ts's per-thread
// markThreadLeadDoNotContact (which has full channel/team context). For
// client-level entries we don't know the channel, so we push to:
//   - Instantly  → POST /block-lists-entries (global per workspace)
//   - EmailBison → POST /api/blacklisted-emails (without switchWorkspace —
//                  best-effort; team scoping happens server-side)
//
// Both attempts are best-effort and swallow their own errors. Per-provider
// success is reported back so the caller can mark the DB row.

export interface BlocklistResult {
  pushedInstantly: boolean;
  pushedEmailBison: boolean;
  error: string | null;
}

export async function enforceBlocklist(email: string): Promise<BlocklistResult> {
  const addr = email.trim().toLowerCase();
  if (!addr) {
    return { pushedInstantly: false, pushedEmailBison: false, error: "missing email" };
  }

  const errors: string[] = [];
  let pushedInstantly = false;
  let pushedEmailBison = false;

  try {
    const inst = createInstantlyClient();
    await inst.blockEmail(addr);
    pushedInstantly = true;
  } catch (err) {
    errors.push(`instantly: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const eb = createEmailBisonClient();
    await eb.blacklistEmail(addr);
    pushedEmailBison = true;
  } catch (err) {
    errors.push(`emailbison: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    pushedInstantly,
    pushedEmailBison,
    error: errors.length > 0 ? errors.join(" · ") : null,
  };
}
