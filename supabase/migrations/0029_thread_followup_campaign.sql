-- 0029: cached EmailBison reply_followup campaign membership per thread.
--
-- The prospect panel needs to show whether a lead is currently enrolled
-- in a reply-follow-up campaign (so we don't double-add them). Reading
-- that live from EmailBison requires 2 API calls per render
-- (scheduled-emails + a campaign-type lookup), so we mirror it onto
-- the thread row — same pattern as 0021's Instantly subsequence cache.
--
--   followup_campaign_id     — the reply_followup campaign id the lead
--                              currently has scheduled sends in, OR (when
--                              status='past') the last one they were in
--   followup_campaign_name   — resolved display name
--   followup_status          — 'active' | 'past' | null
--                              active = has scheduled-emails rows in a
--                                       reply_followup campaign
--                              past   = sent-emails rows exist but no
--                                       scheduled rows remain
--                              null   = never enrolled
--   followup_next_scheduled  — earliest upcoming scheduled_date for the
--                              active campaign (informational)
--   followup_synced_at       — when we last refreshed this from EB
--                              (null = never synced; route does a live
--                              fetch and fills it in)

alter table threads
  add column if not exists followup_campaign_id     bigint,
  add column if not exists followup_campaign_name   text,
  add column if not exists followup_status          text
    check (followup_status in ('active', 'past')),
  add column if not exists followup_next_scheduled  timestamptz,
  add column if not exists followup_synced_at       timestamptz;
