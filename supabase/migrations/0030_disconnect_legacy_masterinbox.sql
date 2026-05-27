-- 0031: disconnect the legacy MasterInbox feed from the portal pipeline.
--
-- The legacy MasterInbox at web-production-d18b09.up.railway.app was the
-- previous source of "Introduction" data. Migration 0027 unified it with
-- the new MasterInbox by:
--   1. Adding external_intros.id as a FK on client_pipeline_entries
--   2. Backfilling pipeline entries from existing external_intros rows
--   3. Installing client_pipeline_external_intro_trigger so each new
--      external_intros INSERT auto-created a pipeline entry
--
-- Client now wants to ONLY work off the new MasterInbox (this workspace's
-- own Introduction-labeled threads). The legacy cron is being disabled
-- at the scheduler level; this migration kills the database side of the
-- bridge and purges pipeline entries that had no thread backing — those
-- rows existed only because a legacy external_intros row triggered them.
--
-- Entries that have BOTH external_intro_id and thread_id are kept: those
-- are real intros that happened to also appear in the legacy feed, and
-- the new MasterInbox is the authoritative source going forward.

-- 1) Stop new legacy rows from auto-creating pipeline entries.
drop trigger if exists client_pipeline_external_intro_trigger
  on public.external_intros;

-- The trigger function itself is kept (in case we need to re-attach
-- it during incident response) but no longer fires.

-- 2) Purge legacy-only pipeline entries — rows that came from
--    external_intros but have no thread in the new MasterInbox.
delete from public.client_pipeline_entries
 where external_intro_id is not null
   and thread_id is null;
