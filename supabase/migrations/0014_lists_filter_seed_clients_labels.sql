-- 0014: query-driven lists keyed on clients + auto-seed label views.
--
-- 1. lists gets a structural `client_id` FK so a list can say "this is the
--    Brooklyn Group list" without baking the client UUID into a JSON blob.
--    Lookups stay portable across env / dumps because the reference goes
--    through clients(id) → clients(slug, name).
-- 2. Seeds one list per non-Unknown client (icon 🏢, name = client name,
--    client_id set on the row). threads.ts narrows by lists.client_id when
--    present; manually-curated lists with NULL client_id still use the
--    legacy thread_list_items membership path.
-- 3. Seeds one custom_view per label, filter_json = labels IS X. Labels are
--    already part of the FilterState model (filter rows store label ids),
--    so the existing JSON-embedded id is consistent with how the rest of
--    the FilterBuilder works.
-- 4. Idempotent — re-runnable; existing rows are not duplicated (matched
--    by workspace_id + client_id for lists, workspace_id + name for views).

-- ---- 1. Schema --------------------------------------------------------------
alter table lists
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- Unique guard so re-running the seed never produces a second list for the
-- same client.
create unique index if not exists lists_workspace_client_unique
  on lists (workspace_id, client_id)
  where client_id is not null;

-- ---- 2. Seed: one list per client ------------------------------------------
-- Skip the "Unknown" fallback — it isn't a real client.
insert into lists (workspace_id, name, icon, client_id, sort_order, shared)
select
  '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid,
  c.name,
  '🏢',
  c.id,
  100 + row_number() over (order by c.name),
  true
from clients c
where c.slug <> 'unknown'
on conflict (workspace_id, client_id) where client_id is not null
do nothing;

-- ---- 3. Seed: one custom_view per label ------------------------------------
-- Icon per sentiment so tabs are scannable at a glance.
with label_icon as (
  select 'positive'::text as sentiment, '✅'::text as icon union all
  select 'negative',                    '🚫' union all
  select 'neutral',                     '🏷️'
)
insert into custom_views (workspace_id, name, icon, filter_json, sort_order, shared, is_system)
select
  '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid,
  l.name,
  coalesce(li.icon, '🏷️'),
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
  ),
  100 + l.sort_order,
  true,
  false
from labels l
left join label_icon li on li.sentiment = l.sentiment::text
where l.workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
  and not exists (
    select 1 from custom_views cv
    where cv.workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'::uuid
      and cv.name = l.name
  );
