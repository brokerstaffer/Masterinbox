-- 0035: per-lead "Assigned agent" on the recruiting pipeline.
--
-- Clients wanted to pick which of their own agents (from the Your
-- Agents roster) is matched to / paired with each lead in the
-- pipeline, plus a bulk action to assign the same agent to many leads
-- at once. The pool comes from client_agents; nullable so "Unassigned"
-- is the default and clearing is just a set-to-null.

alter table public.client_pipeline_entries
  add column if not exists assigned_agent_id uuid
  references public.client_agents(id) on delete set null;

create index if not exists client_pipeline_assigned_agent_idx
  on public.client_pipeline_entries (client_id, assigned_agent_id)
  where assigned_agent_id is not null;
