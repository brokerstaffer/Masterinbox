import type { PipelineEntry } from "@/lib/portals/portal-data";
import type { FubPerson } from "@/lib/integrations/followup-boss";

// Build the FUB person payload for a pipeline entry. Only fields that
// have actual values are included — FUB accepts sparse payloads and
// won't error on missing data (verified against the live API), but we
// still trim empties so we never overwrite a real value in FUB with
// our null.
//
// Custom-field keys we send below are matched against the connected
// FUB account's customFields catalog. If a key doesn't exist on that
// account, FUB silently drops it; that's a feature for v1 because it
// means a client doesn't have to create EVERY field for the push to
// succeed.

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

  // -- Brokerage --
  // Maps to FUB's customBrokerage (the events POST silently ignores
  // person.company, confirmed against the live API).
  if (entry.current_brokerage && entry.current_brokerage.trim()) {
    person.customBrokerage = entry.current_brokerage.trim();
  }

  // -- Tags --
  // Always tag with BrokerStaffer so the client can filter in FUB.
  person.tags = [REQUIRED_TAG];

  // -- Introduction Date --
  // FUB date fields accept YYYY-MM-DD. introduced_at is a full ISO
  // timestamp; slice to date for the custom field. We DON'T set
  // occurredAt at the top level because FUB treats anything >1 day
  // old as historical and won't trigger automations on it.
  if (entry.introduced_at) {
    person.customIntroductionDate = entry.introduced_at.slice(0, 10);
  }

  // -- Custom-field extraction from the merged custom_fields map --
  // The loader (lib/portals/portal-data.ts) already merges
  // leads.custom_fields with external_intros.lead_detail.custom_fields
  // into entry.lead_detail.custom_fields. Pull the rich agent fields
  // from there using a key-alias table — the same logical field is
  // stored under different keys across campaigns.
  const cf = (entry.lead_detail?.custom_fields ?? {}) as Record<
    string,
    unknown
  >;

  const officeCity =
    pickStr(cf, "office city", "Office City", "office_city") ??
    entry.lead_location ??
    null;
  if (officeCity) person.customOfficeCity = officeCity;

  const mls = pickStr(cf, "mls", "MLS", "MLS Affiliation", "mls_affiliation");
  if (mls) person.customMLSAffiliation = mls;

  const topProducingCity = pickStr(
    cf,
    "Most transacted city",
    "most transacted city",
    "Top producing city",
    "top producing city",
    "Top Producing City",
    "top producing county",
  );
  if (topProducingCity) person.customTopProducingCity = topProducingCity;

  const buySide = pickStr(
    cf,
    "Buy-side ($)",
    "Buy-side",
    "buy-side",
    "buy_side",
    "Buy Side",
  );
  if (buySide) person.customBuySideSalesVolume = buySide;

  const listSide = pickStr(
    cf,
    "List-side ($)",
    "List-side",
    "list-side",
    "list_side",
    "List Side",
  );
  if (listSide) person.customListSideSalesVolume = listSide;

  const salesVolume = pickStr(
    cf,
    "Sales volume",
    "sales volume",
    "Total sales",
    "Sales last 12 months",
    "LTM Sales Volume",
  );
  if (salesVolume) person.customLTMSalesVolume = salesVolume;

  const avgPrice = pickStr(
    cf,
    "Avg. sales price",
    "Avg sales price",
    "Avg Sales Price",
    "average sales price",
  );
  if (avgPrice) person.customAvgSalesPrice = avgPrice;

  const closedRentals = pickStr(cf, "Closed rentals", "closed rentals");
  if (closedRentals) person.customClosedRentals = closedRentals;

  const gci = pickStr(
    cf,
    "Approx. GCI",
    "approx gci",
    "Estimated GCI",
    "estimated gci",
    "GCI",
  );
  if (gci) person.customApproxGCI = gci;

  // -- Profile URLs --
  // Collect every profile URL we've seen on this lead, then bucket
  // each by hostname into Zillow / Realtor.com / Courted / generic
  // Agent Profile / Other Profile. First URL into each slot wins so
  // we don't clobber Zillow with a second Zillow.
  const profileUrls = collectProfileUrls(entry, cf);
  for (const url of profileUrls) {
    const lower = url.toLowerCase();
    if (lower.includes("zillow.com") && !person.customZillowUrl) {
      person.customZillowUrl = url;
    } else if (
      lower.includes("realtor.com") &&
      !person.customRealtorcomProfile
    ) {
      person.customRealtorcomProfile = url;
    } else if (
      (lower.includes("courted.io") || lower.includes("courted.com")) &&
      !person.customCourtedProfileURL
    ) {
      person.customCourtedProfileURL = url;
    } else if (!person.customAgentProfileLink) {
      // Anything we can't bucket falls into the generic Agent Profile
      // slot first. The OTHER slot below catches subsequent extras.
      person.customAgentProfileLink = url;
    } else if (!person.customOtherProfile) {
      person.customOtherProfile = url;
    }
  }

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

// First non-empty string value found across the supplied keys. Lets us
// match the same logical field across the case + punctuation variants
// different campaigns store it under.
function pickStr(
  cf: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = cf[k];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

// Gather every profile URL associated with this lead. Order matters —
// downstream we assign by hostname, first URL into each slot wins.
function collectProfileUrls(
  entry: PipelineEntry,
  cf: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const trimmed = v.trim();
    if (!trimmed) return;
    if (!out.includes(trimmed)) out.push(trimmed);
  };

  // The top-level agent_profile_url is the loader's normalised one.
  push(entry.agent_profile_url);

  // Then dig through custom_fields for every URL-shaped key.
  const profileKeys = [
    "Agent Profile",
    "agent profile",
    "Agent profile",
    "agent_profile",
    "Zillow Profile",
    "Zillow",
    "StreetEasy/Zillow",
    "StreetEasy Profile",
    "Realtor.com Profile",
    "Realtor Profile",
    "Courted Profile",
    "Courted",
    "Profile URL",
    "Other Profile",
  ];
  for (const k of profileKeys) push(cf[k]);

  return out;
}
