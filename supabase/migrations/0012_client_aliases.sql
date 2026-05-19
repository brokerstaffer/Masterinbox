-- Migration 0012: per-client alias list for fuzzier campaign matching
--
-- The seeded client names don't always match the provider's campaign names
-- exactly. Examples seen live:
--   campaign "C21 Results Elite Team - GA"   vs client "C21 Results - Elite Team"
--   campaign "Howe Realty (2) - Maricopa"    vs client "Howe Realty Group"
-- Both currently fall through to the "Unknown" client.
--
-- Aliases let the user attach extra substrings to a client. The matcher
-- (lib/clients/derive.ts) checks the canonical name AND every alias —
-- whichever matches longest wins.

alter table clients add column if not exists aliases text[] not null default '{}';

-- Optional: lower-case GIN index would help large workspaces. Skip for now
-- (25 rows total) — sequential scan is fine.
