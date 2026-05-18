-- User-curated thread lists (sidebar items below the inbox section).
-- Plus thread-level read state to drive the unread indicator dot.

create table if not exists lists (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  owner_user_id   uuid references auth.users(id) on delete set null,
  name            text not null,
  icon            text,                            -- emoji or icon key
  sort_order      integer not null default 0,
  shared          boolean not null default true,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);
create index if not exists lists_workspace_order_idx on lists (workspace_id, sort_order);

create trigger lists_set_updated_at before update on lists
  for each row execute function public.set_updated_at();

-- Membership table: a thread can belong to many lists.
create table if not exists thread_list_items (
  list_id        uuid not null references lists(id) on delete cascade,
  thread_id      uuid not null references threads(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  added_by       uuid references auth.users(id) on delete set null,
  added_at       timestamptz not null default timezone('utc', now()),
  primary key (list_id, thread_id)
);
create index if not exists thread_list_items_thread_idx on thread_list_items (workspace_id, thread_id);
create index if not exists thread_list_items_list_idx on thread_list_items (list_id);

-- Read state: workspace-level seen flag on threads. New inbound replies set
-- this to false; opening the thread (or the bulk "Mark as seen" action)
-- flips it true. A per-user state would be more correct but adds a wide
-- table — workspace-level matches the actual UX in the screenshots.
alter table threads add column if not exists seen boolean not null default true;

-- RLS — same policy template as the other workspace-scoped tables.
alter table lists enable row level security;
alter table thread_list_items enable row level security;

do $$
declare t text;
declare tables text[] := array['lists', 'thread_list_items'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I_sel_select on %I', t, t);
    execute format('drop policy if exists %I_ins_insert on %I', t, t);
    execute format('drop policy if exists %I_upd_update on %I', t, t);
    execute format('drop policy if exists %I_del_delete on %I', t, t);
    execute format('create policy %I_sel_select on %I for select using (public.is_workspace_member(workspace_id))', t, t);
    execute format('create policy %I_ins_insert on %I for insert with check (public.is_workspace_member(workspace_id))', t, t);
    execute format('create policy %I_upd_update on %I for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t, t);
    execute format('create policy %I_del_delete on %I for delete using (public.is_workspace_member(workspace_id))', t, t);
  end loop;
end$$;

-- New inbound replies should arrive as "unseen". Patch the sync trigger
-- in the application code; here we backfill any existing threads that
-- still have the old default.
update threads set seen = false where needs_reply = true;
