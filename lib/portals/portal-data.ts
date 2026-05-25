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

export interface PipelineEntry {
  id: string;
  stage: PipelineStage;
  needs_replacement: boolean;
  notes: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  current_brokerage: string | null;
  agent_profile_url: string | null;
  introduced_at: string | null;
  // Full Instantly enrichment payload for the lead detail side-panel.
  // null when the entry was triggered by a label assignment (no
  // external_intros row backed it).
  lead_detail: Record<string, unknown> | null;
  campaign_name: string | null;
}

export interface DncEntry {
  id: string;
  kind: "agent" | "company";
  name: string;
  email: string | null;
  phone: string | null;
  brokerage: string | null;
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
  market: string | null;
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
  receives: "intro" | "digest" | "admin";
  active: boolean;
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
    // from external_intros via the FK. PostgREST flattens this into a
    // nested object on each row.
    const { data, error } = await admin
      .from("client_pipeline_entries")
      .select(
        "id, stage, needs_replacement, notes, lead_name, lead_email, lead_phone, current_brokerage, agent_profile_url, introduced_at, external_intros:external_intro_id (lead_detail, campaign_name)",
      )
      .eq("client_id", clientId)
      .order("introduced_at", { ascending: false })
      .range(0, 9_999);
    if (error || !data) return [];
    return (data as unknown as Array<
      Omit<PipelineEntry, "lead_detail" | "campaign_name"> & {
        external_intros:
          | { lead_detail: Record<string, unknown> | null; campaign_name: string | null }
          | { lead_detail: Record<string, unknown> | null; campaign_name: string | null }[]
          | null;
      }
    >).map((r) => {
      // PostgREST returns the joined row as either a single object or an
      // array depending on cardinality config. Normalise to scalar.
      const ext = Array.isArray(r.external_intros)
        ? r.external_intros[0] ?? null
        : r.external_intros;
      const { external_intros: _ignore, ...rest } = r;
      void _ignore;
      return {
        ...rest,
        lead_detail: ext?.lead_detail ?? null,
        campaign_name: ext?.campaign_name ?? null,
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
        "id, kind, name, email, phone, brokerage, notes, added_by, pushed_to_instantly, pushed_to_emailbison, push_error, created_at",
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
        "id, name, email, phone, license, market, pushed_to_instantly, pushed_to_emailbison, push_error, created_at",
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
        "id, name, email, title, receives, active, pushed_to_instantly, pushed_to_emailbison, push_error, created_at",
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

export const STAGE_LABELS: Record<PipelineStage, string> = {
  introduction: "Introduction",
  phone_screen: "Phone Screen",
  interview: "Interview",
  hired: "Hired",
  keep_warm: "Keep Warm",
  we_they_rejected: "We/They Rejected",
  no_show: "No Show / No Response",
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
