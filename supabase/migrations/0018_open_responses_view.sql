-- 0018: "Open Responses" system view.
--
-- A work-queue tab that the FilterBuilder can't express, because it's an
-- OR of two conditions rather than AND-ed rows:
--   (a) tagged "Interested" AND NOT tagged "Meetings Booked"
--   (b) no labels at all (an untagged lead that needs manual tagging)
--
-- The membership logic lives in lib/inbox/open-responses.ts, keyed off
-- the `open_responses` preset. This row just makes the tab exist; it
-- sorts right after "All Email" (sort_order 0). Idempotent.

insert into custom_views (workspace_id, name, icon, filter_json, sort_order, is_system)
select w.id,
       'Open Responses',
       null,
       '{"preset":"open_responses","rows":[]}'::jsonb,
       1,
       true
from workspaces w
where not exists (
  select 1 from custom_views cv
  where cv.workspace_id = w.id
    and cv.name = 'Open Responses'
);
