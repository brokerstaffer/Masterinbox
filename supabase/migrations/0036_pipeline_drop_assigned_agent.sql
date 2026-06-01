-- 0036: drop the per-lead "Assigned agent" column.
--
-- Background: 0035 added client_pipeline_entries.assigned_agent_id so
-- clients could pair a Your-Agents roster member with each lead. In
-- practice the affordance wasn't being used and the column added more
-- visual noise than value, so the client asked for it removed
-- end-to-end (UI + DB). Drop the index first to avoid leaving a
-- dangling reference.

drop index if exists public.client_pipeline_assigned_agent_idx;

alter table public.client_pipeline_entries
  drop column if exists assigned_agent_id;
