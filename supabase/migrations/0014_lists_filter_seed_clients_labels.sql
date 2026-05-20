-- 0014: query-driven lists + auto-seed one list per client and one custom_view
-- per label.
--
-- 1. Adds `filter_json jsonb` to lists. When set, threads.ts uses the filter
--    instead of thread_list_items membership — a list becomes a "live"
--    auto-populated bucket (e.g. "every thread for client X").
-- 2. Seeds one list per non-Unknown client, filter = client_id IS X. Names
--    default to the client name with a 🏢 icon; user can rename / re-emoji
--    later from the sidebar.
-- 3. Seeds one custom_view per label, filter = label_id IS X. These appear as
--    tabs above the thread list, regardless of which sidebar list / All Email
--    is selected. Emoji icon matches the label's sentiment family.
-- 4. All seeds are idempotent — re-runnable; existing rows are not duplicated
--    (matched by workspace_id + name).

-- ---- 1. Schema --------------------------------------------------------------
alter table lists add column if not exists filter_json jsonb;

-- ---- 2. Seed: one list per client ------------------------------------------
-- Skips the "Unknown" fallback client — it isn't a real client, just a bucket
-- for unmatched campaigns.
insert into lists (workspace_id, name, icon, filter_json, sort_order, shared)
select
  '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid as workspace_id,
  c.name,
  '🏢' as icon,
  jsonb_build_object(
    'rows',
    jsonb_build_array(
      jsonb_build_object(
        'id', substr(md5(c.id::text || 'list'), 1, 8),
        'enabled', true,
        'field', 'clients',
        'operator', 'is',
        'value', jsonb_build_array(c.id::text)
      )
    )
  ) as filter_json,
  100 + row_number() over (order by c.name) as sort_order,
  true as shared
from clients c
where c.slug <> 'unknown'
  and not exists (
    select 1 from lists l
    where l.workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
      and l.name = c.name
  );

-- ---- 3. Seed: one custom_view per label ------------------------------------
-- Icon per sentiment so tabs are scannable at a glance.
with label_icon as (
  select 'positive' as sentiment, '✅' as icon union all
  select 'negative',                '🚫' union all
  select 'neutral',                 '🏷️'
)
insert into custom_views (workspace_id, name, icon, filter_json, sort_order, shared, is_system)
select
  '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid as workspace_id,
  l.name,
  coalesce(li.icon, '🏷️') as icon,
  jsonb_build_object(
    'rows',
    jsonb_build_array(
      jsonb_build_object(
        'id', substr(md5(l.id::text || 'view'), 1, 8),
        'enabled', true,
        'field', 'labels',
        'operator', 'is',
        'value', jsonb_build_array(l.id::text)
      )
    )
  ) as filter_json,
  100 + l.sort_order as sort_order,
  true as shared,
  false as is_system
from labels l
left join label_icon li on li.sentiment = l.sentiment::text
where l.workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
  and not exists (
    select 1 from custom_views cv
    where cv.workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
      and cv.name = l.name
  );
