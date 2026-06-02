-- 0045: per-client "most recent UNSEEN inbound reply" timestamp.
--
-- 0044 introduced client_inbox_activity (max sent_at of any inbound
-- reply per client) to drive the MasterInbox sidebar auto-sort. In
-- practice operators reported that wasn't quite right: a client who
-- replied two hours ago but whose reply has already been opened
-- still sat at the top, pushing a client with an UNREAD reply down
-- the list. The whole point of the sort is to surface unhandled
-- activity — once you've read it, the bump should go away.
--
-- This view adds the missing slice: max sent_at of inbound messages
-- on threads that are still UNSEEN. The sidebar loader sorts by
-- this first (tier 1), then by the older all-inbound view (tier 2)
-- for clients whose recent activity has been triaged, then by name.
--
-- One row per (workspace, client). Clients with no unseen threads
-- simply don't appear in the view — the loader treats a missing
-- row as "no unread activity" and falls through to the next tier.
--
-- Filter on `t.seen = false` (the thread-level flag the operator
-- flips when opening a thread). status is intentionally NOT
-- constrained: archived / trash / spam threads with a fresh
-- inbound shouldn't bubble the client to the top, but they're
-- already marked seen by the move-to-archive flow so the
-- t.seen=false filter handles it transitively.

create or replace view public.client_unseen_inbox_activity as
  select t.workspace_id,
         t.client_id,
         max(m.sent_at) as last_unseen_inbound_at
  from public.messages m
  join public.threads t on t.id = m.thread_id
  where m.direction = 'inbound'
    and t.seen = false
    and t.client_id is not null
  group by t.workspace_id, t.client_id;

comment on view public.client_unseen_inbox_activity is
  'Per-(workspace, client) timestamp of the most recent inbound '
  'message on a still-UNSEEN thread. Tier-1 sort key for the '
  'MasterInbox sidebar.';
