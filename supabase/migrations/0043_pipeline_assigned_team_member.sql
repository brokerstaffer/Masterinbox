-- 0043: assign a Team member to each Recruiting Pipeline entry.
--
-- Why: some brokerages have multiple recruiters running intros and
-- need to identify which recruiter owns each candidate. The portal
-- already maintains a Team roster (client_team_members) for
-- intro-notification addressing — same table can act as the
-- ownership target.
--
-- We had a prior `assigned_agent_id` in 0035 that pointed at
-- client_agents; 0036 dropped it because client_agents is the
-- exclusion roster, not the recruiter roster. This is the correct
-- target.
--
-- ON DELETE SET NULL so removing a team member unassigns every
-- candidate they owned instead of cascading the pipeline rows away.

alter table public.client_pipeline_entries
  add column if not exists assigned_team_member_id uuid
    references public.client_team_members(id) on delete set null;

-- Partial index — most rows will be unassigned for a while, and the
-- only queries we'll run against this column ask "who is this lead's
-- owner?" (one-row lookup via the FK) or "what does recruiter X own?"
-- Both benefit from skipping the long NULL tail.
create index if not exists client_pipeline_entries_assigned_team_member_idx
  on public.client_pipeline_entries (assigned_team_member_id)
  where assigned_team_member_id is not null;
