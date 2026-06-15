import type { PipelineEntry } from "@/lib/portals/portal-data";
import type { FubPerson } from "@/lib/integrations/followup-boss";

// Build the FUB person payload for a pipeline entry.
//
// Per user direction (2026-06-16), the payload is intentionally minimal:
// only the standard FUB person fields — firstName / lastName, emails,
// phones — plus the BrokerStaffer tag. Source is set at the EVENT
// layer (not here) in lib/integrations/followup-boss.ts pushPersonEvent
// (`source: "BrokerStaffer"` on the event body).
//
// Every richer custom-field mapping (Brokerage, Office City, MLS,
// sales-volume, GCI, profile URLs, Introduction Date, etc.) was
// removed by request — clients didn't want them syncing. The pickStr
// + collectProfileUrls helpers went with them. Re-introducing custom
// fields later is a matter of `git log` + re-export.
//
// FUB accepts sparse payloads and won't error on missing data
// (verified against the live API), but we still trim empties so we
// never overwrite a real value in FUB with our null.

const REQUIRED_TAG = "BrokerStaffer";

export function buildFubPayload(entry: PipelineEntry): FubPerson {
  const person: FubPerson = {};

  // -- Name --
  const { firstName, lastName } = splitName(entry.lead_name);
  if (firstName) person.firstName = firstName;
  if (lastName) person.lastName = lastName;

  // -- Email --
  if (entry.lead_email && entry.lead_email.includes("@")) {
    person.emails = [{ type: "work", value: entry.lead_email.trim() }];
  }

  // -- Phone --
  if (entry.lead_phone && entry.lead_phone.trim()) {
    person.phones = [{ type: "mobile", value: entry.lead_phone.trim() }];
  }

  // -- Tags --
  // Always tag with BrokerStaffer so the client can filter / build
  // smart lists on it inside FUB.
  person.tags = [REQUIRED_TAG];

  return person;
}

// Split "First Last" or "First Middle Last" into firstName + lastName.
// Single-word names go entirely into firstName (FUB tolerates that).
function splitName(
  full: string | null,
): { firstName: string | null; lastName: string | null } {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}
