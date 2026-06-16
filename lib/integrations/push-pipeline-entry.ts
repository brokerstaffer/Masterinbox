import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadPipelineEntries } from "@/lib/portals/portal-data";
import { pushPersonEvent } from "@/lib/integrations/followup-boss";
import { buildFubPayload } from "@/lib/integrations/build-fub-payload";

// Shared push helper called from the manual "Push to FUB" route and
// from the inline auto-push hook on stage transitions. Wraps:
//   • load the entry (with merged custom_fields)
//   • load the client's FUB API key
//   • short-circuit if key is unset
//   • call FUB
//   • write fub_event_id / fub_pushed_at on success, fub_last_error
//     on failure
//
// Returns a tagged result so the caller knows whether to toast green
// or red. Never throws.

export type PushOutcome =
  | { ok: true; mode: "created" | "updated"; personId: string | null }
  | { ok: false; reason: "no_key" | "no_entry" | "api_error" | "no_contact"; message: string };

export async function pushPipelineEntryToFub(
  clientId: string,
  entryId: string,
): Promise<PushOutcome> {
  const admin = createAdminSupabase();

  const { data: clientRow } = await admin
    .from("clients")
    .select("id, fub_api_key")
    .eq("id", clientId)
    .maybeSingle();
  if (!clientRow) {
    return {
      ok: false,
      reason: "no_entry",
      message: "Client not found",
    };
  }
  const apiKey = (clientRow.fub_api_key as string | null) ?? null;
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      reason: "no_key",
      message: "Follow Up Boss is not connected for this client",
    };
  }

  const entries = await loadPipelineEntries(clientId);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return {
      ok: false,
      reason: "no_entry",
      message: "Lead not found",
    };
  }

  const person = buildFubPayload(entry);
  const hasEmail = Array.isArray(person.emails) && person.emails.length > 0;
  const hasPhone = Array.isArray(person.phones) && person.phones.length > 0;
  if (!hasEmail && !hasPhone) {
    const note = "Lead has no email or phone — nothing to push to Follow Up Boss";
    await admin
      .from("client_pipeline_entries")
      .update({ fub_last_error: note, updated_at: new Date().toISOString() })
      .eq("id", entryId);
    return { ok: false, reason: "no_contact", message: note };
  }

  const result = await pushPersonEvent(apiKey, person, {
    message: `Introduced via BrokerStaffer${
      entry.introduced_at ? ` on ${entry.introduced_at.slice(0, 10)}` : ""
    }`,
    // Per-entry source: historical rows / introduction-label trigger
    // rows all default to "BrokerStaffer" (the migration default),
    // portal-added rows that came through with the pipeline_source_split
    // flag on carry "Client Entry". FUB will display whichever the
    // entry was tagged with at write time.
    source: entry.source,
  });

  if (!result.ok) {
    const note = `${result.status}: ${result.error}`.slice(0, 500);
    await admin
      .from("client_pipeline_entries")
      .update({ fub_last_error: note, updated_at: new Date().toISOString() })
      .eq("id", entryId);
    return { ok: false, reason: "api_error", message: result.error };
  }

  await admin
    .from("client_pipeline_entries")
    .update({
      fub_event_id: result.eventId,
      fub_pushed_at: new Date().toISOString(),
      fub_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  return {
    ok: true,
    mode: result.status === 201 ? "created" : "updated",
    personId: result.personId,
  };
}
