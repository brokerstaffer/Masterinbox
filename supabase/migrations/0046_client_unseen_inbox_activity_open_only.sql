-- 0046: tighten client_unseen_inbox_activity to OPEN threads only.
--
-- 0045 created the view filtering on `t.seen = false` alone. In
-- production we found a row that bubbled a client to the top of
-- the sidebar even though its only unread thread was in TRASH —
-- the loadListUnseenCounts pill (status='open' AND seen=false)
-- showed no "N new" badge, so operators saw an out-of-order entry
-- with no indication why.
--
-- Add `t.status = 'open'` so the sort agrees with the pill exactly:
-- a client only earns the Tier-1 unread bump if it has an unread
-- inbound on a thread the operator is actively triaging in the
-- inbox. Archived / trash / spam threads still count as inbound
-- activity for Tier-2 (handled by the broader client_inbox_activity
-- view) but never re-rank a client to the top.

create or replace view public.client_unseen_inbox_activity as
  select t.workspace_id,
         t.client_id,
         max(m.sent_at) as last_unseen_inbound_at
  from public.messages m
  join public.threads t on t.id = m.thread_id
  where m.direction = 'inbound'
    and t.seen = false
    and t.status = 'open'
    and t.client_id is not null
  group by t.workspace_id, t.client_id;
