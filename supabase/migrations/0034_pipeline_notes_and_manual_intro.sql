-- 0034: multi-note system for the recruiting pipeline + auto-tag the
-- "Replacement" affordance off the No-Show stage.
--
-- Background: client_pipeline_entries.notes was a single free-text
-- blob. Operators wanted timestamped, per-event notes (one row per
-- note) so they can track call attempts / outreach over time.
-- "Replace?" checkbox was redundant with the No-Show stage, so we let
-- the stage drive that signal and surface it as a tag in the UI.

create table if not exists public.client_pipeline_notes (
  id uuid primary key default uuid_generate_v4(),
  entry_id uuid not null references public.client_pipeline_entries(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists client_pipeline_notes_entry_idx
  on public.client_pipeline_notes (entry_id, created_at desc);

drop trigger if exists client_pipeline_notes_set_updated_at
  on public.client_pipeline_notes;

create trigger client_pipeline_notes_set_updated_at
  before update on public.client_pipeline_notes
  for each row execute function public.set_updated_at();

-- One-time backfill: each non-empty notes blob becomes a single note
-- row dated to the entry's last-update. We DO NOT clear the legacy
-- column; readers prefer the table once it has rows.
insert into public.client_pipeline_notes (entry_id, body, created_at, updated_at)
select id, notes, coalesce(updated_at, created_at), coalesce(updated_at, created_at)
from public.client_pipeline_entries
where notes is not null
  and length(trim(notes)) > 0
  and not exists (
    select 1 from public.client_pipeline_notes n where n.entry_id = client_pipeline_entries.id
  );
