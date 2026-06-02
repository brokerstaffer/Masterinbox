-- 0042: dedup keys for client_dnc_entries and client_team_members.
--
-- Background: Your Agents already gets one-line CSV upserts in
-- O(1) DB calls because client_agents has a (client_id, email)
-- unique index and the route uses
--   .upsert(..., { onConflict: "client_id,email", ignoreDuplicates: true })
-- The DNC CSV route still loops one INSERT per row + a 250 ms
-- throttle, so a 300-row upload waits at least 75s. Team has no CSV
-- path at all and lacks a (client_id, email) uniqueness guard so
-- duplicates are possible.
--
-- This migration brings both up to the Agents pattern:
--
--   client_dnc_entries
--     • add `dedup_key text GENERATED ALWAYS AS lower(domain) for
--       company rows / lower(email) for agent rows`
--     • normalise existing rows so the new index can land
--     • delete the 5 known agent-email duplicates (keeping the
--       oldest of each), per the audit above
--     • full unique index on (client_id, dedup_key) — NULLS distinct,
--       so rows without an email AND without a domain (rare but
--       legal) still coexist
--
--   client_team_members
--     • lowercase existing emails for case-insensitive dedup
--     • full unique index on (client_id, lower(email))

-- ── client_dnc_entries ────────────────────────────────────────────

-- Normalize existing email / domain to lowercase so dedup matches
-- across "Foo@x.com" / "foo@x.com" / "X.com" / "x.com".
update public.client_dnc_entries
set email = lower(trim(email))
where email is not null and email <> lower(trim(email));

update public.client_dnc_entries
set domain = lower(trim(domain))
where domain is not null and domain <> lower(trim(domain));

-- Drop existing duplicates so the new unique index can be created.
-- Keep the oldest row per (client_id, lower(email)) for agents.
delete from public.client_dnc_entries a
using public.client_dnc_entries b
where a.client_id = b.client_id
  and a.kind = 'agent' and b.kind = 'agent'
  and a.email is not null and b.email is not null
  and a.email = b.email
  and a.created_at > b.created_at;

-- And the same for company rows by domain (none today, but safe).
delete from public.client_dnc_entries a
using public.client_dnc_entries b
where a.client_id = b.client_id
  and a.kind = 'company' and b.kind = 'company'
  and a.domain is not null and b.domain is not null
  and a.domain = b.domain
  and a.created_at > b.created_at;

-- Stored generated column = lower(domain) for company rows,
-- lower(email) for agent rows. NULL when neither column has a value
-- (rare but legal — e.g. company entry where only the brokerage
-- name is known).
alter table public.client_dnc_entries
  add column if not exists dedup_key text
  generated always as (
    case
      when kind = 'company' then lower(domain)
      else lower(email)
    end
  ) stored;

-- Full unique index on (client_id, dedup_key). Postgres treats NULL
-- as distinct by default, so multiple null-key rows can still
-- coexist per client. Same shape that fixed the Agents CSV upload
-- in 0040 — full index, not partial.
create unique index if not exists client_dnc_entries_dedup
  on public.client_dnc_entries (client_id, dedup_key);

-- ── client_team_members ───────────────────────────────────────────

update public.client_team_members
set email = lower(trim(email::text))::citext
where email is not null
  and email::text <> lower(trim(email::text));

-- email is a citext column already, but a unique index keeps the
-- guarantee at the storage layer so the new CSV path can upsert.
create unique index if not exists client_team_members_unique_email
  on public.client_team_members (client_id, email);
