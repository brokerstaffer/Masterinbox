-- ==============================================================
-- 0001_init.sql
-- ==============================================================
-- BrokerStaffer Master Inbox — initial schema
-- Multi-tenant from day one: every business table has workspace_id + RLS.
-- Provider-mirror fields are prefixed emailbison_* / unipile_*.

set check_function_bodies = off;

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ============================================================================
-- enums
-- ============================================================================

create type member_role          as enum ('owner', 'admin', 'member');
create type member_status        as enum ('invited', 'active', 'removed');
create type channel_type         as enum ('email', 'linkedin');
create type channel_provider     as enum ('emailbison', 'unipile');
create type channel_status       as enum ('connected', 'disconnected', 'error', 'pending');
create type label_sentiment      as enum ('positive', 'negative', 'neutral');
create type label_platform       as enum ('email', 'linkedin', 'both');
create type lead_stage           as enum ('prospect', 'lead', 'deal', 'client');
create type thread_status        as enum ('open', 'archived', 'spam', 'trash', 'reminder');
create type thread_folder        as enum ('inbox', 'marketing', 'spam');
create type message_direction    as enum ('inbound', 'outbound');
create type assignment_source    as enum ('user', 'ai', 'webhook', 'system');
create type assignment_target    as enum ('thread', 'lead', 'message');
create type agent_mode           as enum ('human_in_loop', 'auto');
create type ai_provider          as enum ('openai', 'anthropic', 'openrouter', 'vllm');
create type draft_status         as enum ('pending', 'approved', 'sent', 'rejected', 'failed');
create type reminder_status      as enum ('pending', 'fired', 'dismissed');
create type webhook_sub_status   as enum ('active', 'paused', 'error');

-- ============================================================================
-- helpers
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ============================================================================
-- workspaces + members
-- ============================================================================

create table workspaces (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  slug            citext not null unique,
  owner_user_id   uuid not null references auth.users(id) on delete restrict,
  plan            text not null default 'free',
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);
create trigger workspaces_set_updated_at before update on workspaces
  for each row execute function public.set_updated_at();

create table workspace_members (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade,
  invited_email   citext,
  role            member_role not null default 'member',
  status          member_status not null default 'active',
  invited_by      uuid references auth.users(id),
  invite_token    text,
  invite_expires_at timestamptz,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id),
  check (user_id is not null or invited_email is not null)
);
create index on workspace_members (workspace_id);
create index on workspace_members (user_id);
create trigger members_set_updated_at before update on workspace_members
  for each row execute function public.set_updated_at();

-- ============================================================================
-- membership helper — used in every RLS policy below
-- security definer to bypass RLS recursion on workspace_members
-- ============================================================================

create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.has_workspace_role(ws_id uuid, required member_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and status = 'active'
      and (
        role = 'owner'
        or (required = 'admin' and role in ('owner', 'admin'))
        or (required = 'member' and role in ('owner', 'admin', 'member'))
      )
  );
$$;

-- ============================================================================
-- channels (one row per connected email account or LinkedIn account)
-- ============================================================================

create table channels (
  id                          uuid primary key default uuid_generate_v4(),
  workspace_id                uuid not null references workspaces(id) on delete cascade,
  type                        channel_type not null,
  provider                    channel_provider not null,
  display_name                text not null,
  external_account_id         text,
  emailbison_sender_email_id  text,
  unipile_account_id          text,
  credentials_encrypted       bytea,
  status                      channel_status not null default 'pending',
  last_synced_at              timestamptz,
  last_error                  text,
  created_at                  timestamptz not null default timezone('utc', now()),
  updated_at                  timestamptz not null default timezone('utc', now())
);
create index on channels (workspace_id);
create unique index channels_emailbison_unique on channels (workspace_id, emailbison_sender_email_id)
  where emailbison_sender_email_id is not null;
create unique index channels_unipile_unique on channels (workspace_id, unipile_account_id)
  where unipile_account_id is not null;
create trigger channels_set_updated_at before update on channels
  for each row execute function public.set_updated_at();

-- ============================================================================
-- labels + label_assignments
-- ============================================================================

create table labels (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  name                text not null,
  color               text not null default 'zinc',
  sentiment           label_sentiment not null default 'neutral',
  platform            label_platform not null default 'both',
  obligation          boolean not null default false,
  sort_order          integer not null default 0,
  emailbison_tag_id   text,
  mirror_to_emailbison boolean not null default false,
  is_system           boolean not null default false,
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name)
);
create index on labels (workspace_id);
create trigger labels_set_updated_at before update on labels
  for each row execute function public.set_updated_at();

-- ============================================================================
-- leads / prospects
-- ============================================================================

create table leads (
  id                     uuid primary key default uuid_generate_v4(),
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  full_name              text,
  email                  citext,
  linkedin_url           text,
  company                text,
  title                  text,
  custom_fields          jsonb not null default '{}'::jsonb,
  emailbison_lead_id     text,
  unipile_attendee_id    text,
  stage                  lead_stage not null default 'prospect',
  source_campaign_id     text,
  first_seen_at          timestamptz,
  last_activity_at       timestamptz,
  created_at             timestamptz not null default timezone('utc', now()),
  updated_at             timestamptz not null default timezone('utc', now())
);
create index on leads (workspace_id);
create index leads_email_idx on leads (workspace_id, email);
create unique index leads_emailbison_unique on leads (workspace_id, emailbison_lead_id)
  where emailbison_lead_id is not null;
create unique index leads_unipile_unique on leads (workspace_id, unipile_attendee_id)
  where unipile_attendee_id is not null;
create trigger leads_set_updated_at before update on leads
  for each row execute function public.set_updated_at();

-- ============================================================================
-- threads
-- ============================================================================

create table threads (
  id                       uuid primary key default uuid_generate_v4(),
  workspace_id             uuid not null references workspaces(id) on delete cascade,
  channel_id               uuid references channels(id) on delete set null,
  lead_id                  uuid references leads(id) on delete set null,
  subject                  text,
  last_message_at          timestamptz,
  last_message_preview     text,
  message_count            integer not null default 0,
  our_reply_count          integer not null default 0,
  their_reply_count        integer not null default 0,
  status                   thread_status not null default 'open',
  folder                   thread_folder not null default 'inbox',
  needs_reply              boolean not null default false,
  emailbison_thread_id     text,
  unipile_chat_id          text,
  created_at               timestamptz not null default timezone('utc', now()),
  updated_at               timestamptz not null default timezone('utc', now())
);
create index on threads (workspace_id, status, last_message_at desc);
create index on threads (lead_id);
create index on threads (channel_id);
create unique index threads_emailbison_unique on threads (workspace_id, emailbison_thread_id)
  where emailbison_thread_id is not null;
create unique index threads_unipile_unique on threads (workspace_id, unipile_chat_id)
  where unipile_chat_id is not null;
create trigger threads_set_updated_at before update on threads
  for each row execute function public.set_updated_at();

-- ============================================================================
-- messages
-- ============================================================================

create table messages (
  id                       uuid primary key default uuid_generate_v4(),
  workspace_id             uuid not null references workspaces(id) on delete cascade,
  thread_id                uuid not null references threads(id) on delete cascade,
  channel_id               uuid references channels(id) on delete set null,
  direction                message_direction not null,
  sender                   text,
  recipients               jsonb not null default '{}'::jsonb,
  subject                  text,
  body_html                text,
  body_text                text,
  sent_at                  timestamptz,
  external_message_id      text,
  emailbison_reply_id      text,
  unipile_message_id       text,
  raw_payload              jsonb,
  created_at               timestamptz not null default timezone('utc', now())
);
create index on messages (thread_id, sent_at);
create index on messages (workspace_id, sent_at desc);
create unique index messages_external_unique on messages (workspace_id, external_message_id)
  where external_message_id is not null;

create table message_attachments (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  message_id      uuid not null references messages(id) on delete cascade,
  filename        text not null,
  mime_type       text,
  size_bytes      bigint,
  storage_path    text,
  external_url    text,
  created_at      timestamptz not null default timezone('utc', now())
);
create index on message_attachments (message_id);

-- ============================================================================
-- label_assignments (polymorphic by target_type)
-- ============================================================================

create table label_assignments (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  label_id        uuid not null references labels(id) on delete cascade,
  target_type     assignment_target not null,
  target_id       uuid not null,
  assigned_by     assignment_source not null default 'user',
  assigned_user_id uuid references auth.users(id),
  assigned_at     timestamptz not null default timezone('utc', now()),
  unique (label_id, target_type, target_id)
);
create index on label_assignments (workspace_id, target_type, target_id);

-- ============================================================================
-- reply agents + drafts
-- ============================================================================

create table reply_agents (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  name                text not null,
  mode                agent_mode not null default 'human_in_loop',
  tone                text not null default 'professional',
  response_length     text not null default 'medium',
  max_tokens          integer not null default 30000,
  temperature         numeric(3,2) not null default 0.1,
  provider            ai_provider not null default 'openai',
  model               text not null default 'gpt-4o-mini',
  api_key_encrypted   bytea,
  system_prompt       text,
  channel_ids         uuid[] not null default '{}',
  active              boolean not null default true,
  auto_respond_new    boolean not null default false,
  stats               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);
create index on reply_agents (workspace_id);
create trigger reply_agents_set_updated_at before update on reply_agents
  for each row execute function public.set_updated_at();

create table reply_drafts (
  id                 uuid primary key default uuid_generate_v4(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  thread_id          uuid not null references threads(id) on delete cascade,
  agent_id           uuid references reply_agents(id) on delete set null,
  generated_subject  text,
  generated_body     text,
  status             draft_status not null default 'pending',
  tokens_prompt      integer,
  tokens_completion  integer,
  error_message      text,
  created_at         timestamptz not null default timezone('utc', now()),
  sent_at            timestamptz,
  sent_message_id    uuid references messages(id)
);
create index on reply_drafts (workspace_id, status);
create index on reply_drafts (thread_id);

-- ============================================================================
-- AI labeling config — one row per workspace
-- ============================================================================

create table ai_labeling_config (
  workspace_id        uuid primary key references workspaces(id) on delete cascade,
  enabled             boolean not null default false,
  provider            ai_provider not null default 'openai',
  api_key_encrypted   bytea,
  model               text not null default 'gpt-4o-mini',
  label_old_replies   boolean not null default false,
  relabel_ongoing     boolean not null default false,
  use_custom_prompt   boolean not null default true,
  custom_prompt       text,
  category_set        text[] not null default '{}',
  last_run_at         timestamptz,
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);
create trigger ai_labeling_config_set_updated_at before update on ai_labeling_config
  for each row execute function public.set_updated_at();

-- ============================================================================
-- webhook subscriptions, custom views (filter tabs), reminders, sync state
-- ============================================================================

create table webhook_subscriptions (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  provider        channel_provider not null,
  event_types     text[] not null default '{}',
  secret          text,
  target_url      text not null,
  status          webhook_sub_status not null default 'active',
  last_event_at   timestamptz,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);
create trigger webhook_subscriptions_set_updated_at before update on webhook_subscriptions
  for each row execute function public.set_updated_at();

create table custom_views (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  owner_user_id   uuid references auth.users(id) on delete set null,
  name            text not null,
  icon            text,
  filter_json     jsonb not null default '{}'::jsonb,
  sort_order      integer not null default 0,
  shared          boolean not null default true,
  is_system       boolean not null default false,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);
create index on custom_views (workspace_id, sort_order);
create trigger custom_views_set_updated_at before update on custom_views
  for each row execute function public.set_updated_at();

create table reminders (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  thread_id       uuid not null references threads(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade,
  remind_at       timestamptz not null,
  note            text,
  status          reminder_status not null default 'pending',
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);
create index on reminders (workspace_id, remind_at);
create index on reminders (status, remind_at) where status = 'pending';

create table sync_state (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  provider        channel_provider not null,
  cursor          text,
  last_polled_at  timestamptz,
  unique (workspace_id, provider)
);

create table audit_log (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  actor_user_id   uuid references auth.users(id) on delete set null,
  action          text not null,
  target_type     text,
  target_id       text,
  payload         jsonb,
  created_at      timestamptz not null default timezone('utc', now())
);
create index on audit_log (workspace_id, created_at desc);

-- ============================================================================
-- RLS — enable on every table and add policies
-- ============================================================================

alter table workspaces                 enable row level security;
alter table workspace_members          enable row level security;
alter table channels                   enable row level security;
alter table labels                     enable row level security;
alter table leads                      enable row level security;
alter table threads                    enable row level security;
alter table messages                   enable row level security;
alter table message_attachments        enable row level security;
alter table label_assignments          enable row level security;
alter table reply_agents               enable row level security;
alter table reply_drafts               enable row level security;
alter table ai_labeling_config         enable row level security;
alter table webhook_subscriptions      enable row level security;
alter table custom_views               enable row level security;
alter table reminders                  enable row level security;
alter table sync_state                 enable row level security;
alter table audit_log                  enable row level security;

-- workspaces: members can read; owner can update; only authenticated user can insert (creating their own)
create policy workspaces_select on workspaces for select
  using (public.is_workspace_member(id));
create policy workspaces_insert on workspaces for insert
  with check (owner_user_id = auth.uid());
create policy workspaces_update on workspaces for update
  using (public.has_workspace_role(id, 'admin'))
  with check (public.has_workspace_role(id, 'admin'));
create policy workspaces_delete on workspaces for delete
  using (owner_user_id = auth.uid());

-- workspace_members: members of a workspace can see members; admins can manage
create policy ws_members_select on workspace_members for select
  using (
    user_id = auth.uid()
    or public.is_workspace_member(workspace_id)
  );
create policy ws_members_insert on workspace_members for insert
  with check (
    -- workspace owner can self-add during creation
    exists (select 1 from workspaces w where w.id = workspace_id and w.owner_user_id = auth.uid())
    or public.has_workspace_role(workspace_id, 'admin')
  );
create policy ws_members_update on workspace_members for update
  using (public.has_workspace_role(workspace_id, 'admin'))
  with check (public.has_workspace_role(workspace_id, 'admin'));
create policy ws_members_delete on workspace_members for delete
  using (public.has_workspace_role(workspace_id, 'admin') or user_id = auth.uid());

-- generic per-workspace policies for the rest
do $$
declare
  t text;
  tables text[] := array[
    'channels','labels','leads','threads','messages','message_attachments',
    'label_assignments','reply_agents','reply_drafts','ai_labeling_config',
    'webhook_subscriptions','custom_views','reminders','sync_state','audit_log'
  ];
begin
  foreach t in array tables loop
    execute format('create policy %I_select on %I for select using (public.is_workspace_member(workspace_id));', t || '_sel', t);
    execute format('create policy %I_insert on %I for insert with check (public.is_workspace_member(workspace_id));', t || '_ins', t);
    execute format('create policy %I_update on %I for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));', t || '_upd', t);
    execute format('create policy %I_delete on %I for delete using (public.is_workspace_member(workspace_id));', t || '_del', t);
  end loop;
end$$;

-- ============================================================================
-- default-labels + onboarding triggers
-- when a workspace is created we also create the owner's membership row
-- and seed the system labels + default custom views + ai_labeling_config
-- ============================================================================

create or replace function public.bootstrap_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_labels constant text[][] := array[
    -- name, color, sentiment, platform, obligation
    array['Interested',          'green',  'positive', 'both',  'false'],
    array['Information Request', 'zinc',   'positive', 'both',  'false'],
    array['Meetings Booked',     'pink',   'positive', 'both',  'false'],
    array['Not Interested',      'zinc',   'negative', 'both',  'false'],
    array['Not Right Now',       'amber',  'neutral',  'both',  'false'],
    array['Wrong Person',        'zinc',   'neutral',  'both',  'false'],
    array['Do Not Contact',      'red',    'negative', 'both',  'true'],
    array['OOO Sequence',        'amber',  'neutral',  'email', 'false'],
    array['Automated Response',  'zinc',   'neutral',  'email', 'false'],
    array['Unable to Categorize','zinc',   'neutral',  'both',  'false'],
    array['Add to Blocklist',    'stone',  'negative', 'both',  'true'],
    array['Cold-Leads',          'red',    'neutral',  'both',  'false'],
    array['Form',                'pink',   'neutral',  'both',  'false']
  ];
  row_data text[];
  i int := 0;
begin
  -- owner becomes an active member
  insert into workspace_members (workspace_id, user_id, role, status)
  values (new.id, new.owner_user_id, 'owner', 'active')
  on conflict do nothing;

  -- seed labels
  foreach row_data slice 1 in array default_labels loop
    insert into labels (workspace_id, name, color, sentiment, platform, obligation, sort_order, is_system)
    values (
      new.id,
      row_data[1],
      row_data[2],
      row_data[3]::label_sentiment,
      row_data[4]::label_platform,
      row_data[5]::boolean,
      i,
      true
    )
    on conflict do nothing;
    i := i + 1;
  end loop;

  -- ai labeling config row
  insert into ai_labeling_config (workspace_id, category_set)
  values (
    new.id,
    array[
      'Interested','Not Interested','Not Right Now','Wrong Person',
      'Do Not Contact','OOO Sequence','Automated Response','Unable to Categorize',
      'Information Request','Meetings Booked'
    ]
  )
  on conflict do nothing;

  -- default custom views (the tabs in the screenshot)
  insert into custom_views (workspace_id, owner_user_id, name, icon, filter_json, sort_order, shared, is_system) values
    (new.id, new.owner_user_id, 'Needs Reply',     'inbox',    '{"preset":"needs_reply"}'::jsonb,     0, true, true),
    (new.id, new.owner_user_id, 'Follow-Up 1',     'reply',    '{"preset":"follow_up","step":1}'::jsonb, 1, true, true),
    (new.id, new.owner_user_id, 'Follow-Up 2',     'reply',    '{"preset":"follow_up","step":2}'::jsonb, 2, true, true),
    (new.id, new.owner_user_id, 'Follow-Up 3',     'reply',    '{"preset":"follow_up","step":3}'::jsonb, 3, true, true),
    (new.id, new.owner_user_id, 'Engaged',         'flame',    '{"preset":"engaged"}'::jsonb,         4, true, true),
    (new.id, new.owner_user_id, 'Meeting Pipeline','calendar', '{"preset":"meeting_pipeline"}'::jsonb,5, true, true),
    (new.id, new.owner_user_id, 'All Email',       'mail',     '{"preset":"all_email"}'::jsonb,       6, true, true),
    (new.id, new.owner_user_id, 'DNC',             'ban',      '{"preset":"dnc"}'::jsonb,             7, true, true)
  on conflict do nothing;

  return new;
end;
$$;

create trigger workspaces_bootstrap after insert on workspaces
  for each row execute function public.bootstrap_workspace();

-- ============================================================================
-- realtime
-- ============================================================================
-- Idempotent registration — Supabase may pre-add some tables to the
-- supabase_realtime publication on project creation, and a one-shot bundle
-- replay should never error with "already member of publication".

do $$
declare
  t text;
  tbls text[] := array['messages','threads','reply_drafts','label_assignments'];
begin
  foreach t in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end$$;


-- ==============================================================
-- 0002_workspace_mirror.sql
-- ==============================================================
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


-- ==============================================================
-- 0003_simplify_default_views.sql
-- ==============================================================
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


-- ==============================================================
-- 0004_ai_labeling_crypto.sql
-- ==============================================================
-- pgcrypto helpers for storing per-workspace AI provider keys without
-- letting plaintext travel through PostgREST. The web tier calls these
-- RPCs with the APP_ENCRYPTION_KEY (env-side secret) — Postgres handles
-- the actual encryption/decryption.

create or replace function public.ai_labeling_set_key(
  p_workspace uuid,
  p_key text,
  p_plaintext text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into ai_labeling_config (workspace_id, api_key_encrypted)
  values (p_workspace, pgp_sym_encrypt(p_plaintext, p_key))
  on conflict (workspace_id)
  do update set api_key_encrypted = pgp_sym_encrypt(p_plaintext, p_key),
                updated_at = timezone('utc', now());
end;
$$;

-- Returns the labeling config row joined with the decrypted api_key.
-- Used by the labeling job; never exposed to the browser.
create or replace function public.ai_labeling_decrypt(
  p_workspace uuid,
  p_key text
)
returns table(
  workspace_id uuid,
  enabled boolean,
  provider ai_provider,
  api_key text,
  model text,
  label_old_replies boolean,
  relabel_ongoing boolean,
  use_custom_prompt boolean,
  custom_prompt text,
  category_set text[],
  last_run_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    c.workspace_id,
    c.enabled,
    c.provider,
    case when c.api_key_encrypted is null then null
         else pgp_sym_decrypt(c.api_key_encrypted, p_key) end as api_key,
    c.model,
    c.label_old_replies,
    c.relabel_ongoing,
    c.use_custom_prompt,
    c.custom_prompt,
    c.category_set,
    c.last_run_at
  from ai_labeling_config c
  where c.workspace_id = p_workspace;
end;
$$;

-- Lock the functions down — only the service role should call them.
revoke all on function public.ai_labeling_set_key(uuid, text, text) from public;
revoke all on function public.ai_labeling_decrypt(uuid, text) from public;
grant execute on function public.ai_labeling_set_key(uuid, text, text) to service_role;
grant execute on function public.ai_labeling_decrypt(uuid, text) to service_role;

-- Update last_run_at after a labeling pass.
create or replace function public.ai_labeling_touch_run(p_workspace uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update ai_labeling_config set last_run_at = timezone('utc', now()) where workspace_id = p_workspace;
$$;

revoke all on function public.ai_labeling_touch_run(uuid) from public;
grant execute on function public.ai_labeling_touch_run(uuid) to service_role;


-- ==============================================================
-- 0005_lists_and_seen.sql
-- ==============================================================
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


-- ==============================================================
-- 0006_thread_outbound_sender.sql
-- ==============================================================
-- Denormalised: store the workspace sender email address that owns this
-- thread. Every LEAD_REPLIED webhook carries `data.sender_email.email` —
-- that's the OUR-side address (e.g. "sender@brokerstaffer.com"). Pinning
-- it on the thread row means the UI can always show "(our@email) You"
-- without having to traverse messages, and reply composers can pre-fill
-- the From field even before the user has sent anything.

alter table threads add column if not exists outbound_sender_email text;

-- Index isn't strictly needed (we always look this up by thread id), but a
-- partial index keeps null rows out of any future filtered queries.
create index if not exists threads_outbound_sender_email_idx
  on threads (outbound_sender_email) where outbound_sender_email is not null;


-- ==============================================================
-- 0007_reply_agent_crypto.sql
-- ==============================================================
-- pgcrypto helpers for per-agent API keys (same pattern as ai_labeling_*).

create or replace function public.reply_agent_set_key(
  p_agent uuid,
  p_key text,
  p_plaintext text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update reply_agents
    set api_key_encrypted = pgp_sym_encrypt(p_plaintext, p_key),
        updated_at = timezone('utc', now())
  where id = p_agent;
end;
$$;

create or replace function public.reply_agent_decrypt(
  p_agent uuid,
  p_key text
)
returns table(
  id uuid,
  workspace_id uuid,
  name text,
  mode agent_mode,
  tone text,
  response_length text,
  max_tokens integer,
  temperature numeric,
  provider ai_provider,
  model text,
  api_key text,
  system_prompt text,
  channel_ids uuid[],
  active boolean,
  auto_respond_new boolean,
  stats jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    a.id, a.workspace_id, a.name, a.mode, a.tone, a.response_length,
    a.max_tokens, a.temperature, a.provider, a.model,
    case when a.api_key_encrypted is null then null
         else pgp_sym_decrypt(a.api_key_encrypted, p_key) end as api_key,
    a.system_prompt, a.channel_ids, a.active, a.auto_respond_new,
    a.stats, a.created_at, a.updated_at
  from reply_agents a
  where a.id = p_agent;
end;
$$;

revoke all on function public.reply_agent_set_key(uuid, text, text) from public;
revoke all on function public.reply_agent_decrypt(uuid, text) from public;
grant execute on function public.reply_agent_set_key(uuid, text, text) to service_role;
grant execute on function public.reply_agent_decrypt(uuid, text) to service_role;


-- ==============================================================
-- 0008_reply_agent_channel.sql
-- ==============================================================
-- Channel filter on reply agents. Reuses the same set of values as
-- label_platform (email / linkedin / both) but stored as text so we can
-- migrate without touching the enum type.

alter table reply_agents
  add column if not exists channel_filter text not null default 'both';

alter table reply_agents
  drop constraint if exists reply_agents_channel_filter_check;
alter table reply_agents
  add constraint reply_agents_channel_filter_check
  check (channel_filter in ('email', 'linkedin', 'both'));

-- Rebuild the decrypt RPC to include the new column. Postgres rejects
-- changing the return type of an existing function via CREATE OR REPLACE,
-- so we drop it first.
drop function if exists public.reply_agent_decrypt(uuid, text);

create or replace function public.reply_agent_decrypt(
  p_agent uuid,
  p_key text
)
returns table(
  id uuid,
  workspace_id uuid,
  name text,
  mode agent_mode,
  tone text,
  response_length text,
  max_tokens integer,
  temperature numeric,
  provider ai_provider,
  model text,
  api_key text,
  system_prompt text,
  channel_ids uuid[],
  channel_filter text,
  active boolean,
  auto_respond_new boolean,
  stats jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    a.id, a.workspace_id, a.name, a.mode, a.tone, a.response_length,
    a.max_tokens, a.temperature, a.provider, a.model,
    case when a.api_key_encrypted is null then null
         else pgp_sym_decrypt(a.api_key_encrypted, p_key) end as api_key,
    a.system_prompt, a.channel_ids, a.channel_filter, a.active, a.auto_respond_new,
    a.stats, a.created_at, a.updated_at
  from reply_agents a
  where a.id = p_agent;
end;
$$;

revoke all on function public.reply_agent_decrypt(uuid, text) from public;
grant execute on function public.reply_agent_decrypt(uuid, text) to service_role;


-- ==============================================================
-- 0009_realtime_label_assignments.sql
-- ==============================================================
-- Add label_assignments to the Realtime publication so the inbox UI gets
-- a live refresh when a label is assigned/removed (AI labeling pass,
-- bulk label action, etc.).
--
-- Idempotent: 0001's realtime block already adds this table; guard so a
-- one-shot bundle replay doesn't error with "already member of publication".

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'label_assignments'
  ) then
    alter publication supabase_realtime add table label_assignments;
  end if;
end$$;


-- ==============================================================
-- 0010_BrokerStaffer_singleton_instantly_clients.sql
-- ==============================================================
-- Migration 0010: BrokerStaffer single-tenant changes
--
-- Three concerns bundled together because they have to land at once
-- without leaving the schema half-cut:
--   A. Add 'instantly' to channel_provider + instantly_* mirror columns on
--      channels / leads / threads / messages so the new provider can share
--      the existing sync machinery.
--   B. Add a global `clients` table seeded with BrokerStaffer's 24 active clients
--      plus an "Unknown" fallback; pin a client_id on each thread at sync
--      time by substring-matching campaign names. Also denormalise
--      source_provider onto threads/messages so the UI doesn't have to
--      join through channels (and to keep it correct even after a channel
--      row is soft-deleted).
--   C. Move from multi-workspace to single-tenant: an auth.users trigger
--      that auto-creates THE singleton "BrokerStaffer" workspace on the first
--      sign-up and auto-adds every subsequent user as an 'owner' member.
--      The workspace_id column + RLS stay (cheap insurance) — the user
--      surface is single-tenant only.

-- ----------------------------------------------------------------------------
-- A. Instantly support
-- ----------------------------------------------------------------------------

-- Enum mutation must run before any column default referencing the new value.
-- ADD VALUE IF NOT EXISTS is safe to re-run; supported on Postgres 12+.
alter type channel_provider add value if not exists 'instantly';

alter table channels  add column if not exists instantly_account_id text;
alter table channels  add column if not exists instantly_org_id     text;
alter table leads     add column if not exists instantly_lead_id    text;
alter table threads   add column if not exists instantly_thread_id  text;
alter table messages  add column if not exists instantly_email_id   text;

-- The EmailBison "team" (workspace) a sender_email belongs to. Multi-team
-- EmailBison instances (brokerstaffer.com has 2) need this per-channel so
-- sendReply can call switchWorkspace with the right team — workspaces.id is
-- single-tenant in BrokerStaffer and no longer maps 1:1 to a team.
alter table channels  add column if not exists emailbison_team_id integer;
create index if not exists channels_eb_team_idx on channels (emailbison_team_id)
  where emailbison_team_id is not null;

create unique index if not exists channels_instantly_unique
  on channels (workspace_id, instantly_account_id)
  where instantly_account_id is not null;
create unique index if not exists leads_instantly_unique
  on leads (workspace_id, instantly_lead_id)
  where instantly_lead_id is not null;
create unique index if not exists threads_instantly_unique
  on threads (workspace_id, instantly_thread_id)
  where instantly_thread_id is not null;
-- messages already has a unique index on (workspace_id, external_message_id);
-- Instantly rows use external_message_id = 'in:email:{uuid}'.

-- ----------------------------------------------------------------------------
-- B. Source provider + client tagging
-- ----------------------------------------------------------------------------

-- Denormalised source provider on threads + messages. Always equals
-- channel.provider at insert time. Surfacing on threads lets the UI render
-- the EmailBison/Instantly badge without a join; surfacing on messages
-- makes mixed-provider thread merging possible in the future.
alter table threads  add column if not exists source_provider channel_provider;
alter table messages add column if not exists source_provider channel_provider;

-- Backfill any pre-existing rows. The duplicated codebase ships with no
-- production rows, but this is defensive in case the migration is replayed
-- on a database that already has EmailBison data.
update threads  set source_provider = 'emailbison' where source_provider is null;
update messages set source_provider = 'emailbison' where source_provider is null;

create index if not exists threads_source_provider_idx
  on threads (workspace_id, source_provider, last_message_at desc);

-- Global lookup table — not workspace-scoped because BrokerStaffer runs one
-- workspace and all clients are shared. Sync derives the right row by
-- case-insensitive substring on the campaign name.
create table if not exists clients (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  slug        text not null unique,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);
create trigger clients_set_updated_at before update on clients
  for each row execute function public.set_updated_at();

-- client_id on threads. Tag-at-sync-time, not derived per render.
alter table threads add column if not exists client_id uuid
  references clients(id) on delete set null;
create index if not exists threads_client_id_idx on threads (client_id);

-- Seed the 24 active BrokerStaffer clients + "Unknown" fallback. Slugs are
-- referenced from app code; do not change without updating
-- lib/clients/derive.ts.
insert into clients (name, slug) values
  ('Brooklyn Group',                       'brooklyn-group'),
  ('BHGRE Basecamp',                       'bhgre-basecamp'),
  ('Howard Hanna NYC',                     'howard-hanna-nyc'),
  ('EXR',                                  'exr'),
  ('Howe Realty Group',                    'howe-realty-group'),
  ('Military Veteran Team - LPT Realty',   'military-veteran-team-lpt-realty'),
  ('54 Realty',                            '54-realty'),
  ('Camelot Realty Group',                 'camelot-realty-group'),
  ('SPACE',                                'space'),
  ('Raintown Realty',                      'raintown-realty'),
  ('Properties & Estates',                 'properties-and-estates'),
  ('The Keyes Company',                    'the-keyes-company'),
  ('Bastion Realty South',                 'bastion-realty-south'),
  ('Front Range Collective',               'front-range-collective'),
  ('C21 Results - Elite Team',             'c21-results-elite-team'),
  ('Kelly + Co',                           'kelly-and-co'),
  ('PRG Real Estate at EXP',               'prg-real-estate-at-exp'),
  ('SERHANT.',                             'serhant'),
  ('Young Realty',                         'young-realty'),
  ('Spotlight - A Compass Team',           'spotlight-compass'),
  ('MattC Group',                          'mattc-group'),
  ('Douglas Elliman NYC',                  'douglas-elliman-nyc'),
  ('Jeff Cook Real Estate',                'jeff-cook-real-estate'),
  ('JM properties',                        'jm-properties'),
  ('Unknown',                              'unknown')
on conflict (name) do nothing;

-- RLS: clients are a global catalog — every authenticated user can read,
-- only service_role mutates (seed + admin-only edits).
alter table clients enable row level security;
create policy clients_read_authenticated on clients for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');
create policy clients_write_service on clients for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- C. Single-tenant: auto-create singleton workspace + auto-membership
-- ----------------------------------------------------------------------------

-- On the FIRST sign-up: create the singleton "BrokerStaffer" workspace and make
-- this user the owner. The existing bootstrap_workspace AFTER-INSERT
-- trigger on workspaces seeds labels + views + their owner membership.
--
-- On every subsequent sign-up: add this user as an 'owner' member of the
-- singleton workspace. (Every BrokerStaffer employee is effectively co-owner;
-- sign-up gating happens at Supabase Auth — restrict who can sign up.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  select id into ws_id from workspaces order by created_at asc limit 1;

  if ws_id is null then
    insert into workspaces (name, slug, owner_user_id)
    values ('BrokerStaffer', 'BrokerStaffer', new.id)
    returning id into ws_id;
    -- bootstrap_workspace handles the rest (member row, labels, views).
  else
    insert into workspace_members (workspace_id, user_id, role, status)
    values (ws_id, new.id, 'owner', 'active')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


