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
  created_at: string;
}

// Each loader is wrapped in cache() so a single render can fetch them
// once even when several components ask. The portal layout intentionally
// only loads counts; per-page reads happen in the page itself.

export const loadPipelineEntries = cache(
  async (clientId: string): Promise<PipelineEntry[]> => {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("client_pipeline_entries")
      .select(
        "id, stage, needs_replacement, notes, lead_name, lead_email, lead_phone, current_brokerage, agent_profile_url, introduced_at",
      )
      .eq("client_id", clientId)
      .order("introduced_at", { ascending: false })
      .range(0, 9_999);
    if (error || !data) return [];
    return data as PipelineEntry[];
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
      .select("id, name, email, title, receives, active, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .range(0, 999);
    if (error || !data) return [];
    return data as TeamMember[];
  },
);

// Counts for the admin overview and the portal sidebar pills. One round
// trip per surface; cached per-render.
export const loadPortalCounts = cache(
  async (clientId: string) => {
    const admin = createAdminSupabase();
    const [pipeline, dnc, agents, team] = await Promise.all([
      admin
        .from("client_pipeline_entries")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      admin
        .from("client_dnc_entries")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      admin
        .from("client_agents")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
      admin
        .from("client_team_members")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
    ]);
    return {
      pipeline: pipeline.count ?? 0,
      dnc: dnc.count ?? 0,
      agents: agents.count ?? 0,
      team: team.count ?? 0,
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
