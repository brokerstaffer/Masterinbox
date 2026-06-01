-- 0038: pin "Not Interested" to the system presets row.
--
-- The view existed as a non-system custom_view backed by the
-- "Not Interested" label, sitting in the draggable user-views
-- section. Reply managers reported the tab as unclickable; promoting
-- it to a system view moves it next to All Email / Open Responses
-- in the pinned-left band where there's no drag wrapper, and keeps
-- the existing filter (label = Not Interested) so historical
-- assignments still surface.

update public.custom_views
set
  is_system = true,
  -- Sort just after Open Responses so the work-queue presets stay
  -- grouped on the left.
  sort_order = 2
where lower(name) = 'not interested';

-- Push every other non-system view down by one slot so the renumber
-- above doesn't collide with anyone else's sort_order. Affects only
-- the views that previously sat AT or AFTER position 2.
update public.custom_views
set sort_order = sort_order + 1
where is_system = false
  and sort_order >= 2
  and lower(name) <> 'not interested';
