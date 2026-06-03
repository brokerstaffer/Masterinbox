-- 0047: demote the "Not Interested" tab back to a normal user view.
--
-- 0038_not_interested_system_preset.sql flipped this view to
-- `is_system = true` so it'd land in the pinned-left band of the
-- top tab bar — the rationale at the time was "the tab was
-- reported as unclickable, promote it so it sits next to All Email
-- / Open Responses." That symptom was a side-effect of the older
-- URL-overflow bug on huge label filters; 2d39f98 ("Inbox: kill
-- PostgREST URL-overflow for every id-restricted path") fixed
-- that for good, so the system-preset hack is no longer needed.
--
-- Today the side-effect is that operators can't drag Not Interested
-- left/right alongside the other custom views — the tab bar
-- ([components/inbox/tab-bar.tsx]) skips DnD wiring on
-- `is_system = true` rows. Flipping is_system back to false moves
-- the row into the draggable user-views band on the next render.
-- The PATCH /api/custom-views/[id] route already accepts
-- sort_order on this row, so drag persists immediately without
-- further code changes.

update public.custom_views
   set is_system = false
 where lower(name) = 'not interested'
   and is_system = true;
