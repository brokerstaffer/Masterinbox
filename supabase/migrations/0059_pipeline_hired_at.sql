-- Dedicated "hired_at" timestamp on the client pipeline.
--
-- WHY: /api/clients/intros?label=Hired needs the moment an agent was
-- actually hired. There was no such column — the read fell back to
-- updated_at, which moves on ANY edit (notes, custom fields, a later
-- stage change), so it isn't a trustworthy hire date going forward.
--
-- This adds a real hired_at, set by a trigger the instant a row enters
-- the 'hired' stage, on EVERY write path (portal UI, bulk/CSV, API,
-- direct SQL) — not just one route. Older rows stay NULL on purpose; the
-- endpoint keeps falling back to updated_at for them (per product call:
-- "for older records we can use updated_at").
--
-- SAFETY: purely additive. ADD COLUMN of a nullable timestamptz is an
-- instant catalog-only change on modern Postgres (no table rewrite, no
-- lock of consequence). The trigger only writes NEW.hired_at in-row on
-- transitions into 'hired'; it never touches other columns, other rows,
-- or any other table. No backfill, so no historical data is mutated.

alter table public.client_pipeline_entries
  add column if not exists hired_at timestamptz;

-- Stamp hired_at when (and only when) a row enters the 'hired' stage.
--   • INSERT with stage='hired' and no explicit hired_at → stamp now().
--   • UPDATE moving INTO 'hired' from any other stage → stamp now().
-- Re-saving a row that is already 'hired' (e.g. a notes edit) does NOT
-- move hired_at, so the first-hired moment is preserved. Moving out and
-- back into 'hired' re-stamps to the latest hire, which is the desired
-- semantics for the hire date.
create or replace function public.client_pipeline_set_hired_at()
returns trigger
language plpgsql
as $$
begin
  if new.stage = 'hired'
     and (tg_op = 'INSERT' and new.hired_at is null
          or tg_op = 'UPDATE' and old.stage is distinct from 'hired')
  then
    new.hired_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists client_pipeline_set_hired_at on public.client_pipeline_entries;
create trigger client_pipeline_set_hired_at
  before insert or update on public.client_pipeline_entries
  for each row
  execute function public.client_pipeline_set_hired_at();
