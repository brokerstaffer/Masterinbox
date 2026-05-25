// Minimal CSV parser — handles quoted fields (with escaped "" quotes),
// commas and newlines inside quotes. No external dependency. Used for
// the Your Agents bulk import in the portal.

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  // Strip a UTF-8 BOM if present.
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          // Escaped double-quote.
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      // Push pending row, swallow \r\n pairs.
      if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
      if (c === "\r" && src[i + 1] === "\n") i++;
      continue;
    }
    cell += c;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length === 0) return [];

  // First non-empty row = headers.
  const headerLine = rows[0];
  const headers = headerLine.map((h) => normaliseHeader(h));
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((r) => {
      const obj: CsvRow = {};
      for (let i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        obj[headers[i]] = (r[i] ?? "").trim();
      }
      return obj;
    });
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s\-]+/g, "_");
}

// Maps a parsed CSV row to a Your Agents insert payload. Header detection
// is forgiving — accepts a few common synonyms.
export interface AgentRow {
  name: string;
  email: string | null;
  phone: string | null;
  license: string | null;
  market: string | null;
}

export function csvRowToAgent(row: CsvRow): AgentRow | null {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = row[k];
      if (v && v.trim().length > 0) return v.trim();
    }
    return null;
  };
  const first = pick("first_name", "firstname", "first");
  const last = pick("last_name", "lastname", "last");
  const name =
    pick("name", "full_name", "fullname", "agent_name", "agent") ??
    (first && last ? `${first} ${last}` : first ?? last);
  if (!name) return null;
  return {
    name,
    email: pick("email", "email_address", "agent_email"),
    phone: pick("phone", "phone_number", "mobile", "cell"),
    license: pick("license", "license_number", "license_no", "lic"),
    market: pick("market", "city", "region", "location"),
  };
}
