-- Inbox tab-bar counts as a single server-side aggregate.
--
-- WHY: loadViewCounts previously drained every OPEN thread (id + seen)
-- in 1000-row pages, then fetched their label_assignments in ~45
-- chunks, then walked messages for the Open Responses view — all in
-- Node, on EVERY thread open. That was ~2.1s of round-trip
-- amplification per render even though the underlying SQL is a few
-- milliseconds. This function computes the same numbers in one call.
--
-- Returns one row per bucket:
--   kind='total'          → all open threads (all_ct) + unseen (unseen_ct)
--   kind='label'          → per-label all/unseen over open threads
--                           (label_id set)
--   kind='open_responses' → threads with "Interested" AND NOT
--                           "Meetings Booked" AND whose most-recent
--                           message is inbound
--
-- All buckets are scoped to open threads, optionally narrowed to a
-- single client (p_list_client) when a sidebar list is active — the
-- exact scoping loadViewCounts applied before.
--
-- SAFETY: purely additive. Creates one read-only function; touches no
-- table, no data, no policy. Client portals do not call it. STABLE +
-- SECURITY DEFINER so it runs with the same visibility the service
-- role already has (loadViewCounts uses the server/admin client).

create or replace function public.inbox_view_counts(
  p_ws uuid,
  p_list_client uuid default null
)
returns table (kind text, label_id uuid, all_ct bigint, unseen_ct bigint)
language sql
stable
security definer
set search_path = public
as $$
  -- Totals across all open threads (list-scoped).
  select 'total'::text, null::uuid,
         count(*)::bigint,
         count(*) filter (where not t.seen)::bigint
    from threads t
   where t.workspace_id = p_ws
     and t.status = 'open'
     and (p_list_client is null or t.client_id = p_list_client)

  union all

  -- Per-label all / unseen over open threads (list-scoped). One row
  -- per label_id that has at least one open thread.
  select 'label'::text, la.label_id,
         count(distinct la.target_id)::bigint,
         count(distinct la.target_id) filter (where not t.seen)::bigint
    from label_assignments la
    join threads t
      on t.id = la.target_id
     and t.status = 'open'
     and (p_list_client is null or t.client_id = p_list_client)
   where la.workspace_id = p_ws
     and la.target_type = 'thread'
   group by la.label_id

  union all

  -- Open Responses: Interested, not Meetings Booked, last message inbound.
  -- The EXISTS(Interested) prunes to a few hundred candidates before the
  -- per-thread last-message lookup, which uses messages_thread_id_sent_at_idx.
  select 'open_responses'::text, null::uuid,
         count(*)::bigint,
         count(*) filter (where not t.seen)::bigint
    from threads t
   where t.workspace_id = p_ws
     and t.status = 'open'
     and (p_list_client is null or t.client_id = p_list_client)
     and exists (
       select 1 from label_assignments la
         join labels l on l.id = la.label_id
        where la.target_id = t.id
          and la.target_type = 'thread'
          and l.name = 'Interested'
     )
     and not exists (
       select 1 from label_assignments la
         join labels l on l.id = la.label_id
        where la.target_id = t.id
          and la.target_type = 'thread'
          and l.name = 'Meetings Booked'
     )
     and (
       select m.direction
         from messages m
        where m.thread_id = t.id
        order by m.sent_at desc
        limit 1
     ) = 'inbound';
$$;
