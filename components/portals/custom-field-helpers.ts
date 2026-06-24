// EmailBison sends candidate enrichment as a flat list of
// `custom_variables`, then our sync flattens that into a JSONB
// `leads.custom_fields` map. The key names are operator-typed in
// EB and have no enforced casing or naming convention — the same
// concept arrives as "phone", "Phone", "phone number",
// "Phone Number", "PhoneNumber", etc. across different campaigns.
//
// These two helpers normalise that out at render time so the
// portal UI can stay declarative: "pick whichever of these keys
// has a value." Both are pure / synchronous / no I/O.

export function pickFirstString(
  cf: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | null {
  if (!cf) return null;
  for (const k of keys) {
    const v = cf[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Pattern-aware profile-URL picker. Tries the supplied preferred
// list first (highest-precedence known keys), then any other key
// matching `/profile$/i` so newly-introduced variants like
// "Zillow Profile" or "Realtor.com Profile" surface without a
// code change.
export function pickProfileUrl(
  cf: Record<string, unknown> | null | undefined,
  preferred: readonly string[],
): string | null {
  if (!cf) return null;
  const explicit = pickFirstString(cf, preferred);
  if (explicit) return explicit;
  const profileKeys = Object.keys(cf)
    .filter((k) => /profile$/i.test(k))
    .sort((a, b) => a.localeCompare(b));
  return pickFirstString(cf, profileKeys);
}

// Canonical key lists. Centralised so the table cell, the mobile
// card, the detail drawer, and any future surface stay in sync.

export const PHONE_KEYS: readonly string[] = [
  "Phone Number",
  "phone number",
  "Phone number",
  "phone_number",
  "PhoneNumber",
  "phone",
  "Phone",
  "mobile",
  "Mobile",
  "cell",
  "Cell",
];

export const AGENT_PROFILE_PREFERRED_KEYS: readonly string[] = [
  "Courted Profile",
  "courted profile",
  "Agent Profile",
  "agent profile",
  "agentProfile",
  "agent_profile",
  "Zillow Profile",
  "Realtor.com Profile",
  "StreetEasy Profile",
  "realtor profile",
  "brokerage profile",
  "website",
  "Website",
  "url",
  "URL",
];

export const LICENSE_KEYS: readonly string[] = [
  "License Number",
  "License number",
  "license number",
  "LicenseNumber",
];

export const YEARS_KEYS: readonly string[] = [
  "Years In Business",
  "Years in Business",
  "years in business",
  "Years in Industry",
  "Industry Tenure",
  "Est. time in industry",
  "experience",
  "years_experience",
];
