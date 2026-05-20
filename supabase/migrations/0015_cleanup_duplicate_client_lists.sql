-- 0015: remove duplicate client lists left over from the first run of 0014.
--
-- 0014 v1 (now superseded) inserted one list per client using a
-- filter_json blob with no client_id. The revised 0014 added a client_id
-- column and inserted a second copy of each list with client_id set. The
-- unique index (workspace_id, client_id) only catches rows that HAVE
-- client_id, so the older NULL-client_id rows survived → every client
-- showed up twice in the sidebar.
--
-- This cleanup removes ONLY the leftover rows that are safely replaceable
-- by the new ones:
--   - workspace = Corofy
--   - client_id IS NULL on the row (i.e. came from the old migration)
--   - row's name exactly matches a real client's name
--   - AND a sibling row already exists for that same client with
--     client_id set (so deleting won't lose any user-curated state).
--
-- Manually-curated lists with NULL client_id whose names DON'T match any
-- client name are preserved — those are user-created and unrelated.

delete from lists l1
where l1.workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
  and l1.client_id is null
  and exists (
    select 1
    from clients c
    join lists l2
      on l2.workspace_id = l1.workspace_id
     and l2.client_id = c.id
    where c.name = l1.name
      and c.slug <> 'unknown'
  );

-- Sanity check after the cleanup runs:
--   - Each non-Unknown client should have exactly one list row.
--   - Total client-bound lists should equal count(clients where slug<>'unknown').
select
  (select count(*) from clients where slug <> 'unknown') as expected_clients,
  (select count(*) from lists
     where workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
       and client_id is not null) as client_lists_after_cleanup,
  (select count(*) from lists
     where workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
       and client_id is null) as remaining_manual_lists;
