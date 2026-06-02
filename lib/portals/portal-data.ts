import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";

// Per-client data loaders for the portal expansion. Every query goes
// through the service-role admin client with a code-level client_id
// filter — same pattern as lib/portals/intro-leads.ts.

export type PipelineStage =
  | "introduction"
  | "phone_screen"
  | "interview"
  | "hired"
  | "keep_warm"
  | "we_they_rejected"
  | "no_show";

export interface PipelineNote {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineEntry {
  id: string;
  stage: PipelineStage;
  needs_replacement: boolean;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  current_brokerage: string | null;
  agent_profile_url: string | null;
  // Derived at load time from the lead's enrichment payload — surfaced
  // as separate columns so the row template can render them without
  // each component hunting through custom_fields.
  lead_location: string | null;
  introduced_at: string | null;
  // Full Instantly enrichment payload for the lead detail side-panel.
  // null when the entry was triggered by a label assignment (no
  // external_intros row backed it).
  lead_detail: Record<string, unknown> | null;
  campaign_name: string | null;
  // Timestamped notes (newest first). Backed by client_pipeline_notes.
  notes_log: PipelineNote[];
}

export interface DncEntry {
  id: string;
  kind: "agent" | "company";
  name: string;
  email: string | null;
  phone: string | null;
  brokerage: string | null;
  // Company rows carry a normalized blocked domain (added in 0032);
  // agent rows leave this null.
  domain: string | null;
  notes: string | null;
  added_by: string;
  pushed_to_instantly: boolean;
  pushed_to_emailbison: boolean;
  push_error: string | null;
  created_at: string;
}

export interface AgentEntry {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license: string | null;
  pushed_to_instantly: boolean;
  pushed_to_emailbison: boolean;
  push_error: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  title: string | null;
  phone: string | null;
  receives: "intro" | "digest" | "admin";
  active: boolean;
  // Legacy columns from when Team was a second blocklist. We don't
  // write them anymore but the rows still exist; kept on the type so
  // existing data deserialises cleanly. Safe to drop in a future
  // schema cleanup.
  pushed_to_instantly: boolean;
  pushed_to_emailbison: boolean;
  push_error: string | null;
  created_at: string;
}

// Each loader is wrapped in cache() so a single render can fetch them
// once even when several components ask. The portal layout intentionally
// only loads counts; per-page reads happen in the page itself.

export const loadPipelineEntries = cache(
  async (clientId: string): Promise<PipelineEntry[]> => {
    const admin = createAdminSupabase();
    // Pull the pipeline rows + the enriched lead_detail / campaign_name
    // from external_intros via the FK + the lead's custom_fields (so we
    // can derive location/company/website when the snapshot columns are
    // empty). PostgREST flattens these joined rows into nested objects.
    const { data, error } = await admin
      .from("client_pipeline_entries")
      .select(
        "id, stage, needs_replacement, lead_name, lead_email, lead_phone, current_brokerage, agent_profile_url, introduced_at, external_intros:external_intro_id (lead_detail, campaign_name), leads:lead_id (custom_fields, company)",
      )
      .eq("client_id", clientId)
      .order("introduced_at", { ascending: false })
      .range(0, 9_999);
    if (error || !data) return [];

    // Second hop: fetch all timestamped notes for the visible entries in
    // one batched query.
    const entryIds = (data as Array<{ id: string }>).map((r) => r.id);
    const notesByEntry = new Map<string, PipelineNote[]>();
    if (entryIds.length > 0) {
      const { data: noteRows } = await admin
        .from("client_pipeline_notes")
        .select("id, entry_id, body, created_at, updated_at")
        .in("entry_id", entryIds)
        .order("created_at", { ascending: false })
        .range(0, 9_999);
      for (const n of (noteRows ?? []) as Array<PipelineNote & { entry_id: string }>) {
        const arr = notesByEntry.get(n.entry_id) ?? [];
        arr.push({ id: n.id, body: n.body, created_at: n.created_at, updated_at: n.updated_at });
        notesByEntry.set(n.entry_id, arr);
      }
    }

    return (data as unknown as Array<
      Omit<
        PipelineEntry,
        "lead_detail" | "campaign_name" | "notes_log" | "lead_location"
      > & {
        external_intros:
          | { lead_detail: Record<string, unknown> | null; campaign_name: string | null }
          | { lead_detail: Record<string, unknown> | null; campaign_name: string | null }[]
          | null;
        leads:
          | { custom_fields: Record<string, unknown> | null; company: string | null }
          | { custom_fields: Record<string, unknown> | null; company: string | null }[]
          | null;
      }
    >).map((r) => {
      // PostgREST returns the joined row as either a single object or an
      // array depending on cardinality config. Normalise to scalar.
      const ext = Array.isArray(r.external_intros)
        ? r.external_intros[0] ?? null
        : r.external_intros;
      const lead = Array.isArray(r.leads) ? r.leads[0] ?? null : r.leads;
      const cf = (lead?.custom_fields ?? {}) as Record<string, unknown>;
      const extCf = ((ext?.lead_detail as { custom_fields?: Record<string, unknown> } | null)
        ?.custom_fields ?? {}) as Record<string, unknown>;
      const merged = { ...cf, ...extCf };
      const pickStr = (...keys: string[]) => {
        for (const k of keys) {
          const v = merged[k];
          if (v == null) continue;
          const s = String(v).trim();
          if (s && s !== "null" && s !== "undefined") return s;
        }
        return null;
      };

      const { external_intros: _ignore1, leads: _ignore2, ...rest } = r;
      void _ignore1;
      void _ignore2;

      return {
        ...rest,
        current_brokerage:
          rest.current_brokerage ||
          lead?.company ||
          pickStr("companyName", "company", "company_name", "Company", "current_brokerage", "brokerage"),
        agent_profile_url:
          rest.agent_profile_url ||
          pickStr("Agent Profile", "agentProfile", "agent_profile", "website", "Website", "url"),
        lead_location: pickStr(
          "location",
          "Location",
          "city",
          "City",
          "address",
          "Address",
          "market",
          "Market",
        ),
        // Thread the MERGED custom_fields (leads.custom_fields ∪
        // external_intros.lead_detail.custom_fields) so the expanded
        // candidate card surfaces extras for BOTH lead sources:
        //
        //   • legacy external-intros feed → already carried them via
        //     ext.lead_detail.custom_fields.
        //   • Instantly-webhook leads → previously dropped here because
        //     ext.lead_detail was null. Now they ride through.
        //
        // The expanded card's dedup loop skips email/phone/company/
        // title/location, so City, State, LicenseNumber, AgencyZip,
        // Last12Mos_*, etc., render automatically.
        lead_detail: ext?.lead_detail
          ? { ...ext.lead_detail, custom_fields: merged }
          : { custom_fields: merged },
        campaign_name: ext?.campaign_name ?? null,
        notes_log: notesByEntry.get(rest.id) ?? [],
      } satisfies PipelineEntry;
    });
  },
);

export const loadDncEntries = cache(
  async (clientId: string): Promise<DncEntry[]> => {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("client_dnc_entries")
      .select(
        "id, kind, name, email, phone, brokerage, domain, notes, added_by, pushed_to_instantly, pushed_to_emailbison, push_error, created_at",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(0, 9_999);
    if (error || !data) return [];
    return data as DncEntry[];
  },
);

export const loadAgentEntries = cache(
  async (clientId: string): Promise<AgentEntry[]> => {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("client_agents")
      .select(
        "id, name, email, phone, license, pushed_to_instantly, pushed_to_emailbison, push_error, created_at",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(0, 9_999);
    if (error || !data) return [];
    return data as AgentEntry[];
  },
);

export const loadTeamMembers = cache(
  async (clientId: string): Promise<TeamMember[]> => {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("client_team_members")
      .select(
        "id, name, email, title, phone, receives, active, pushed_to_instantly, pushed_to_emailbison, push_error, created_at",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, 999);
    if (error || !data) return [];
    return data as TeamMember[];
  },
);

// Counts for the admin overview and the portal sidebar pills. One RPC
// call returns all four counts in a single round-trip — the SQL lives in
// migration 0025 (portal_counts). Cached per-render so the layout +
// page can share the same numbers without re-asking.
export const loadPortalCounts = cache(
  async (clientId: string) => {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .rpc("portal_counts", { client_uuid: clientId })
      .single();
    if (error || !data) {
      return { pipeline: 0, dnc: 0, agents: 0, team: 0 };
    }
    const row = data as {
      pipeline: number | null;
      dnc: number | null;
      agents: number | null;
      team: number | null;
    };
    return {
      pipeline: row.pipeline ?? 0,
      dnc: row.dnc ?? 0,
      agents: row.agents ?? 0,
      team: row.team ?? 0,
    };
  },
);

// Display labels for the pipeline stage enum. The enum values
// (keep_warm, we_they_rejected) stay frozen in the database to avoid
// a destructive migration; only the user-facing copy changes here.
export const STAGE_LABELS: Record<PipelineStage, string> = {
  introduction: "Introduction",
  phone_screen: "Phone Screen",
  interview: "Interview",
  hired: "Hired",
  keep_warm: "Nurture",
  we_they_rejected: "Not a Fit",
  no_show: "No Show / No Response",
};

// One-line definitions surfaced in the pipeline legend so clients
// understand what each stage means without asking. Order tracks
// STAGE_ORDER below.
export const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  introduction:
    "An agent has been introduced to you and initial contact has been made.",
  phone_screen:
    "The agent is being scheduled for or has completed interviews (phone and/or in person).",
  interview:
    "The agent is being scheduled for or has completed interviews (phone and/or in person).",
  hired: "The agent has accepted and is joining your team.",
  keep_warm:
    "The agent is interested but not ready to move forward yet. We stay in touch and re-engage at the right time.",
  we_they_rejected:
    "The agent was not a fit, the interview did not meet expectations, or the agent decided not to move forward.",
  no_show:
    "The agent did not attend the scheduled phone screen or interview.",
};

export const STAGE_ORDER: PipelineStage[] = [
  "introduction",
  "phone_screen",
  "interview",
  "hired",
  "keep_warm",
  "we_they_rejected",
  "no_show",
];
