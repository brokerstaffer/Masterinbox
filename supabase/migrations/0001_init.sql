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
