-- 0017: reply templates / macros.
--
-- Saved snippets the user can drop into the composer instead of retyping
-- common replies. Workspace-scoped, plain text body. Idempotent.

create table if not exists reply_templates (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  body          text not null default '',
  sort_order    integer not null default 0,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);
create index if not exists reply_templates_ws_order_idx
  on reply_templates (workspace_id, sort_order);

create trigger reply_templates_set_updated_at before update on reply_templates
  for each row execute function public.set_updated_at();

alter table reply_templates enable row level security;

do $$
begin
  drop policy if exists reply_templates_sel on reply_templates;
  drop policy if exists reply_templates_ins on reply_templates;
  drop policy if exists reply_templates_upd on reply_templates;
  drop policy if exists reply_templates_del on reply_templates;
  create policy reply_templates_sel on reply_templates for select
    using (public.is_workspace_member(workspace_id));
  create policy reply_templates_ins on reply_templates for insert
    with check (public.is_workspace_member(workspace_id));
  create policy reply_templates_upd on reply_templates for update
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
  create policy reply_templates_del on reply_templates for delete
    using (public.is_workspace_member(workspace_id));
end$$;
