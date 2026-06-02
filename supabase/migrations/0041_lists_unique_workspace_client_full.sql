-- 0041: replace the PARTIAL unique index on lists with a FULL one
-- so supabase-js's upsert can use it as the ON CONFLICT arbiter.
--
-- Same trap that hit client_agents in 0040: the original index was
--   CREATE UNIQUE INDEX … (workspace_id, client_id) WHERE client_id IS NOT NULL;
-- which Postgres won't pick as the ON CONFLICT arbiter unless the
-- INSERT carries the same WHERE predicate, and supabase-js's upsert
-- doesn't pass one. app/api/clients/route.ts uses
--   .upsert(…, { onConflict: "workspace_id,client_id", ignoreDuplicates: true })
-- against this index when seeding the per-client list — that path
-- would fail today if a row reached it without a client_id, and even
-- in the happy path supabase-js can't reliably bind the partial
-- predicate.
--
-- Switching to a regular (non-partial) unique index keeps the same
-- semantics: Postgres treats NULL as distinct by default, so the
-- legacy null-client_id lists (manually curated lists with no
-- client) can still coexist within a workspace. The index becomes a
-- usable arbiter for ON CONFLICT (workspace_id, client_id).

drop index if exists public.lists_workspace_client_unique;

create unique index if not exists lists_workspace_client_unique
  on public.lists (workspace_id, client_id);
