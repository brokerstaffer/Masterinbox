-- Captures a column that was added directly on the production DB but
-- never landed in a migration file. Detected during the APAC → US-East
-- Supabase project move (2026-05-25): pg_dump from the old project
-- emitted COPY rows for lists.filter_json that the migration-built
-- schema rejected.

alter table public.lists
  add column if not exists filter_json jsonb;
