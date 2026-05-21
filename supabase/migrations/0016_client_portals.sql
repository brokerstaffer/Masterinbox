-- 0016: client portals.
--
-- Each client gets a public, login-free portal at /portal/<token> where the
-- brokerage sees its own "Introduction" leads. The token IS the credential
-- (user chose secret-URL-only), so it must be unguessable.
--
-- 1. portal_token  — the secret path segment. Readable slug prefix + 10
--    random hex chars so it's both recognisable in the admin UI and
--    unguessable in the wild.
-- 2. portal_enabled — quick on/off without destroying the token.
-- 3. Unique partial index so two clients can never collide on a token.
--
-- The "unknown" fallback client gets no portal (it isn't a real client).
-- Idempotent — re-runnable.

alter table clients add column if not exists portal_token text;
alter table clients add column if not exists portal_enabled boolean not null default true;

create unique index if not exists clients_portal_token_unique
  on clients (portal_token)
  where portal_token is not null;

-- Backfill a token for every real client that doesn't have one yet.
update clients
set portal_token = slug || '-' || substr(md5(random()::text || id::text), 1, 10)
where slug <> 'unknown'
  and portal_token is null;

-- Sanity check: every non-Unknown client should now have a unique token.
select
  count(*) filter (where slug <> 'unknown')                         as real_clients,
  count(*) filter (where slug <> 'unknown' and portal_token is not null) as with_token,
  count(distinct portal_token)                                      as distinct_tokens
from clients;
