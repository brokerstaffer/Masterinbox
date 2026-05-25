-- Mirror the Your Agents flow on Team: every team member's email gets
-- pushed to the Instantly + EmailBison provider blocklists when they
-- are added, so cold-outreach can never accidentally land on someone
-- who already works at the brokerage.
--
-- Columns mirror client_agents — same shape so the UI status pill can
-- reuse the same component.

alter table public.client_team_members
  add column if not exists pushed_to_instantly  boolean not null default false,
  add column if not exists pushed_to_emailbison boolean not null default false,
  add column if not exists push_error           text;
