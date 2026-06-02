-- 0040: drop the PARTIAL unique index on client_agents and replace
-- it with a FULL one so supabase-js's upsert can use it as the
-- ON CONFLICT arbiter.
--
-- Background: 0037 introduced
--   CREATE UNIQUE INDEX … (client_id, email) WHERE email IS NOT NULL;
-- so multiple rows with NULL email could coexist per client. The
-- downside surfaced in the portal's "Your Agents" CSV upload: when
-- the CSV had any row without an email (very common — operators
-- paste names + phones with email blank), the POST returned
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
-- Postgres won't pick a partial unique index as the ON CONFLICT
-- arbiter unless the INSERT statement carries the same WHERE
-- predicate, and supabase-js's upsert doesn't pass one.
--
-- Switching to a regular (non-partial) unique index keeps the same
-- semantics — Postgres still treats NULL as distinct by default, so
-- multiple no-email rows under the same client are still allowed —
-- and the index becomes a usable arbiter for ON CONFLICT
-- (client_id, email). The CSV upsert flips from "errors on any
-- null-email row" to working.

drop index if exists public.client_agents_unique_email;

create unique index if not exists client_agents_unique_email
  on public.client_agents (client_id, email);
