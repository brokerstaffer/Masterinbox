-- Strip seeded system views down to "All Email" only — users build the rest
-- themselves via the FilterBuilder. Existing workspaces get the cleanup
-- pass too. Keep the All Email row so every workspace still has one tab.

delete from custom_views
where is_system = true
  and name <> 'All Email';

-- Promote the surviving "All Email" row to sort_order 0 so it lands first.
update custom_views set sort_order = 0 where is_system = true and name = 'All Email';

-- Rewrite bootstrap_workspace so future workspaces are seeded with just one
-- tab. Everything else is user-created via the filter builder.
create or replace function public.bootstrap_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into workspace_members (workspace_id, user_id, role, status)
  values (new.id, new.owner_user_id, 'owner', 'active')
  on conflict do nothing;

  insert into labels (workspace_id, name, color, sentiment, platform, obligation, sort_order, is_system) values
    (new.id, 'Interested',           'green', 'positive', 'both',     true,  0,  true),
    (new.id, 'Information Request',  'amber', 'neutral',  'both',     true,  1,  true),
    (new.id, 'Meetings Booked',      'green', 'positive', 'both',     true,  2,  true),
    (new.id, 'Not Interested',       'red',   'negative', 'both',     false, 3,  true),
    (new.id, 'Not Right Now',        'amber', 'neutral',  'both',     false, 4,  true),
    (new.id, 'Wrong Person',         'zinc',  'neutral',  'both',     false, 5,  true),
    (new.id, 'Do Not Contact',       'red',   'negative', 'both',     false, 6,  true),
    (new.id, 'OOO Sequence',         'amber', 'neutral',  'email',    false, 7,  true),
    (new.id, 'Automated Response',   'stone', 'neutral',  'both',     false, 8,  true),
    (new.id, 'Unable to Categorize', 'stone', 'neutral',  'both',     false, 9,  true),
    (new.id, 'Add to Blocklist',     'zinc',  'negative', 'both',     false, 10, true),
    (new.id, 'Cold-Leads',           'red',   'neutral',  'both',     false, 11, true),
    (new.id, 'Form',                 'pink',  'neutral',  'both',     false, 12, true)
  on conflict do nothing;

  insert into custom_views (workspace_id, owner_user_id, name, icon, filter_json, sort_order, shared, is_system) values
    (new.id, new.owner_user_id, 'All Email', 'mail', '{"preset":"all_email"}'::jsonb, 0, true, true)
  on conflict do nothing;

  insert into ai_labeling_config (workspace_id) values (new.id)
  on conflict do nothing;

  return new;
end;
$$;
