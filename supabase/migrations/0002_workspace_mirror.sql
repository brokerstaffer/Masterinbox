-- Migration 0002: workspaces mirror EmailBison teams 1:1
--
-- Adds an `emailbison_team_id` column. Existing rows (the legacy placeholder
-- workspace) keep this NULL until the sync runs.

alter table workspaces
  add column if not exists emailbison_team_id integer;

create unique index if not exists workspaces_emailbison_team_unique
  on workspaces (emailbison_team_id)
  where emailbison_team_id is not null;

-- Clean up the dev-bootstrap workspace if it has no EmailBison link.
-- Keeping it around would confuse the sidebar workspace switcher once the real
-- teams arrive. Only deletes rows with no channels/threads/messages, so any
-- real data is safe.
do $$
declare
  cleanup_id uuid;
begin
  for cleanup_id in
    select w.id
    from workspaces w
    where w.emailbison_team_id is null
      and not exists (select 1 from channels c where c.workspace_id = w.id)
      and not exists (select 1 from threads t where t.workspace_id = w.id)
      and not exists (select 1 from messages m where m.workspace_id = w.id)
  loop
    delete from workspaces where id = cleanup_id;
  end loop;
end$$;
