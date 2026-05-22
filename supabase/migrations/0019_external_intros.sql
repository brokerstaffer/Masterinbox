-- 0019: external Introduction feed mirror.
--
-- A separate MasterInbox deployment exposes its booked introductions at
--   https://web-production-d18b09.up.railway.app/api/masterinbox/intros
-- but that endpoint takes ~30s to respond — far too slow to call on a
-- portal render.
--
-- This table is a fast local mirror. A cron hits
--   POST /api/cron/sync-external-intros
-- which fetches the feed and upserts every row here. The client portals
-- then read THIS table (milliseconds) and fold it together with our own
-- Supabase Introduction data so each client sees the combined total.
--
-- No duplicates: unique(email, campaign_id) — one person per campaign is
-- one introduction. The sync upserts on that key, so re-runs only ever
-- update existing rows, never duplicate them.

create table if not exists external_intros (
  id                uuid primary key default uuid_generate_v4(),
  email             text not null,
  name              text,
  campaign_id       text not null,
  campaign_name     text,
  -- Resolved at sync time from campaign_name (same derivation the inbound
  -- webhook uses). Null = campaign matched no client → not shown anywhere.
  client_id         uuid references clients(id) on delete set null,
  intro_at          timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default timezone('utc', now()),
  unique (email, campaign_id)
);

create index if not exists external_intros_client_idx
  on external_intros (client_id);

-- Locked to the service-role client. The public portal has no auth user
-- and reads this through the admin client; RLS-on with no policy keeps
-- anon / authenticated roles out entirely.
alter table external_intros enable row level security;
