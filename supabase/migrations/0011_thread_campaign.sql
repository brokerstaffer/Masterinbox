-- Migration 0011: campaign name + id on threads
--
-- Until now, campaign context lived only inside thread.emailbison_thread_id
-- ("eb:lead:X:campaign:Y") or messages.raw_payload (JSONB). The inbox needs
-- it surfaced for: (a) per-thread chip, (b) prospect-panel detail row,
-- (c) filter-by-campaign in the FilterBuilder.
--
-- Denormalised onto threads (not a separate campaigns table) because:
--   - Corofy doesn't manage campaigns inside Master Inbox — they're read-only
--     metadata coming from EmailBison / Instantly. No need for a dedicated
--     CRUD table with owner/permissions/etc.
--   - The list of distinct campaigns is tiny (low hundreds) — Supabase can
--     materialise it on demand via `select distinct campaign_name from threads`
--     for the filter dropdown.
--
-- Backfill: existing rows keep NULL until the next inbound reply touches
-- the thread (sync code below will set both columns on every upsert).

alter table threads add column if not exists campaign_id text;
alter table threads add column if not exists campaign_name text;

create index if not exists threads_campaign_id_idx
  on threads (workspace_id, campaign_id) where campaign_id is not null;
create index if not exists threads_campaign_name_idx
  on threads (workspace_id, campaign_name) where campaign_name is not null;
