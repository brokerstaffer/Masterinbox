-- client_activity_at: "the last time a CLIENT engaged with this lead."
--
-- WHY: updated_at conflates client actions with our own automation. A new
-- intro (we add these daily) creates the row; FollowUp Boss auto-push then
-- bumps updated_at (~28% of portals are FUB-connected); "Move agent"
-- re-tags client_id and bumps updated_at too. So updated_at (and any
-- time-since-assignment filter on it) can't answer "has the client
-- actually engaged with the leads we sent?" — it looks recent even when
-- the client did nothing.
--
-- client_activity_at is stamped ONLY when a client changes a
-- client-editable field, or adds/edits a note. It is deliberately NOT
-- touched by:
--   • intro creation  — the on-Introduction trigger INSERTs the row
--     (this is a BEFORE UPDATE trigger; INSERTs leave client_activity_at
--     NULL until the client acts).
--   • FollowUp Boss push (push-pipeline-entry.ts) — changes only fub_*.
--   • "Move agent"      (api/threads/bulk)        — changes only client_id.
-- Verified: stage is written exclusively by the portal routes, and no
-- cron/sync writes the enumerated fields, so a change to any of them is a
-- genuine client action.
--
-- SAFETY: purely additive. ADD COLUMN (nullable) is instant. The trigger
-- is BEFORE UPDATE, only ever writes NEW.client_activity_at, always
-- RETURN NEW, never raises — it cannot block or alter any write. No
-- backfill: existing rows stay NULL (correctly "no client engagement
-- recorded yet"). Composes with the 0059 hired_at trigger (independent
-- columns) and the 0060 note trigger (extended below).

alter table public.client_pipeline_entries
  add column if not exists client_activity_at timestamptz;

create or replace function public.client_pipeline_set_client_activity()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage
     or new.needs_replacement is distinct from old.needs_replacement
     or new.lead_name is distinct from old.lead_name
     or new.lead_email is distinct from old.lead_email
     or new.lead_phone is distinct from old.lead_phone
     or new.current_brokerage is distinct from old.current_brokerage
     or new.agent_profile_url is distinct from old.agent_profile_url
     or new.introduced_at is distinct from old.introduced_at
     or new.assigned_team_member_id is distinct from old.assigned_team_member_id
     or new.custom_fields_overrides is distinct from old.custom_fields_overrides
  then
    new.client_activity_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists client_pipeline_set_client_activity
  on public.client_pipeline_entries;
create trigger client_pipeline_set_client_activity
  before update on public.client_pipeline_entries
  for each row
  execute function public.client_pipeline_set_client_activity();

-- Extend the 0060 note trigger: adding or editing a note is a client
-- action, so bump client_activity_at alongside updated_at. (The BEFORE
-- UPDATE trigger above won't fire for this because the note-driven UPDATE
-- doesn't change an enumerated field, so we set it explicitly here.)
create or replace function public.client_pipeline_touch_entry_from_note()
returns trigger
language plpgsql
as $$
begin
  update public.client_pipeline_entries
     set updated_at = timezone('utc', now()),
         client_activity_at = timezone('utc', now())
   where id = new.entry_id;
  return new;
end;
$$;
