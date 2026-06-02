-- 0044: per-client "most recent inbound reply" timestamp.
--
-- The MasterInbox sidebar lists clients in user-set sort_order
-- today. Reply managers asked for the list to become dynamic:
-- whichever client most recently received an inbound reply from a
-- lead bubbles to the top automatically. This view exposes the
-- aggregate the sidebar loader needs.
--
-- One row per (workspace_id, client_id) with the max sent_at of any
-- inbound message landed on a thread that belongs to that client.
-- INBOUND only — our own outbound replies must not reshuffle the
-- list (the operator's just-completed reply would otherwise yank
-- the client back to the top, which is the opposite of what they
-- want to see).
--
-- The view runs over messages + threads + filters direction; the
-- existing indexes on (messages.thread_id) and threads(client_id)
-- already cover the join. No denormalised column on `clients` is
-- needed; revisit only if /inbox page-load regresses.

create or replace view public.client_inbox_activity as
  select t.workspace_id,
         t.client_id,
         max(m.sent_at) as last_inbound_at
  from public.messages m
  join public.threads t on t.id = m.thread_id
  where m.direction = 'inbound'
    and t.client_id is not null
  group by t.workspace_id, t.client_id;

comment on view public.client_inbox_activity is
  'Per-(workspace, client) timestamp of the most recent inbound '
  'message across that client''s threads. Drives the MasterInbox '
  'sidebar auto-sort.';
