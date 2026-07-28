-- Make client_pipeline_entries.updated_at the single source of truth for
-- "last lead activity".
--
-- WHY: two API consumers (GET /api/clients/portals.last_lead_activity_at
-- and GET /api/clients/intros[].updated_at) need a per-lead timestamp that
-- bumps on ANY lead-level change. Stage changes and entry edits already
-- move client_pipeline_entries.updated_at (the app sets it on PATCH), but
-- NOTES live in a separate table (client_pipeline_notes) and adding one
-- never touched the parent entry. So a lead that got a note still looked
-- "untouched" — which broke the "stagnant intros" signal.
--
-- This bumps the parent entry's updated_at whenever a note is added or
-- edited, so updated_at now reflects stage changes + edits + notes.
--
-- SAFETY: purely additive. An AFTER INSERT/UPDATE trigger on
-- client_pipeline_notes that does one indexed UPDATE of the parent entry
-- by primary key. It never raises (the parent always exists — entry_id is
-- NOT NULL with an FK), always RETURN NEW, and touches only updated_at —
-- so it cannot block or alter note writes or portal behaviour. The parent
-- UPDATE fires the 0059 hired_at trigger, which is a no-op here because
-- the stage isn't changing. No backfill; historical rows are untouched.

create or replace function public.client_pipeline_touch_entry_from_note()
returns trigger
language plpgsql
as $$
begin
  update public.client_pipeline_entries
     set updated_at = timezone('utc', now())
   where id = new.entry_id;
  return new;
end;
$$;

drop trigger if exists client_pipeline_notes_touch_entry
  on public.client_pipeline_notes;
create trigger client_pipeline_notes_touch_entry
  after insert or update on public.client_pipeline_notes
  for each row
  execute function public.client_pipeline_touch_entry_from_note();
