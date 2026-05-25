-- 0023: client portal expansion — DNC, Your Agents, Team, Recruiting Pipeline.
--
-- Four new per-client tables + a pipeline_stage enum + an auto-create
-- trigger that turns every Introduction-labeled thread into a pipeline
-- row. RLS enabled on all (service-role only — the public portal queries
-- everything via the admin client with a code-level client_id filter,
-- mirroring lib/portals/intro-leads.ts).

create extension if not exists citext;

-- ---- pipeline_stage enum ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type pipeline_stage as enum (
      'introduction','phone_screen','interview','hired',
      'keep_warm','we_they_rejected','no_show'
    );
  end if;
end$$;

-- ---- DNC list ----------------------------------------------------------
create table if not exists client_dnc_entries (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  kind          text not null default 'agent'
                  check (kind in ('agent','company')),
  name          text not null,
  email         text,
  phone         text,
  brokerage     text,
  notes         text,
  added_by      text not null default 'client',   -- 'client' | 'staff'
  pushed_to_instantly  boolean not null default false,
  pushed_to_emailbison boolean not null default false,
  push_error    text,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);
create index if not exists client_dnc_client_idx on client_dnc_entries (client_id);
create index if not exists client_dnc_email_idx
  on client_dnc_entries (lower(email))
  where email is not null;
alter table client_dnc_entries enable row level security;

-- ---- Your Agents (client's own roster — excluded from outreach) -------
create table if not exists client_agents (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  email         text,
  phone         text,
  license       text,
  market        text,
  notes         text,
  pushed_to_instantly  boolean not null default false,
  pushed_to_emailbison boolean not null default false,
  push_error    text,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);
create index if not exists client_agents_client_idx on client_agents (client_id);
create index if not exists client_agents_email_idx
  on client_agents (lower(email))
  where email is not null;
alter table client_agents enable row level security;

-- ---- Team (notification roster — no per-user login) -------------------
create table if not exists client_team_members (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  email         citext not null,
  title         text,
  receives      text not null default 'intro'
                  check (receives in ('intro','digest','admin')),
  active        boolean not null default true,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now()),
  unique (client_id, email)
);
create index if not exists client_team_client_idx on client_team_members (client_id);
alter table client_team_members enable row level security;

-- ---- Recruiting Pipeline (Google Sheets replacement) ------------------
create table if not exists client_pipeline_entries (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  thread_id     uuid references threads(id) on delete set null,
  lead_id       uuid references leads(id)   on delete set null,
  stage         pipeline_stage not null default 'introduction',
  needs_replacement boolean not null default false,
  notes         text,
  -- Snapshot at intro time so the row stays readable if the lead/thread
  -- gets purged or re-tagged. Mirrors the Google Sheets columns.
  lead_name         text,
  lead_email        text,
  lead_phone        text,
  current_brokerage text,
  agent_profile_url text,
  introduced_at     timestamptz,
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now()),
  unique (client_id, thread_id)
);
create index if not exists client_pipeline_client_idx on client_pipeline_entries (client_id);
create index if not exists client_pipeline_stage_idx  on client_pipeline_entries (client_id, stage);
alter table client_pipeline_entries enable row level security;

-- ---- Auto-create pipeline rows on Introduction label ------------------
create or replace function client_pipeline_on_intro_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  intro_label_id uuid;
  th_row record;
  lead_row record;
begin
  if new.target_type <> 'thread' then
    return new;
  end if;

  select id into intro_label_id
    from labels
    where lower(name) = 'introduction'
    limit 1;
  if intro_label_id is null or new.label_id <> intro_label_id then
    return new;
  end if;

  select t.id as thread_id, t.lead_id, t.client_id
    into th_row
    from threads t
    where t.id = new.target_id;
  if th_row.client_id is null then
    return new;
  end if;

  select l.full_name, l.email, l.custom_fields
    into lead_row
    from leads l
    where l.id = th_row.lead_id;

  insert into client_pipeline_entries (
    client_id, thread_id, lead_id, stage,
    lead_name, lead_email, lead_phone, current_brokerage, agent_profile_url,
    introduced_at
  )
  values (
    th_row.client_id, th_row.thread_id, th_row.lead_id, 'introduction',
    lead_row.full_name,
    lead_row.email,
    coalesce(lead_row.custom_fields->>'phone', lead_row.custom_fields->>'Phone'),
    coalesce(lead_row.custom_fields->>'companyName', lead_row.custom_fields->>'company'),
    coalesce(
      lead_row.custom_fields->>'Agent Profile',
      lead_row.custom_fields->>'agentProfile',
      lead_row.custom_fields->>'website'
    ),
    new.assigned_at
  )
  on conflict (client_id, thread_id) do nothing;

  return new;
end;
$$;

drop trigger if exists client_pipeline_intro_label_trigger on label_assignments;
create trigger client_pipeline_intro_label_trigger
after insert on label_assignments
for each row execute function client_pipeline_on_intro_label();

-- ---- One-time backfill -------------------------------------------------
insert into client_pipeline_entries (
  client_id, thread_id, lead_id, stage,
  lead_name, lead_email, lead_phone, current_brokerage, agent_profile_url,
  introduced_at
)
select
  t.client_id, t.id, t.lead_id, 'introduction',
  l.full_name, l.email,
  coalesce(l.custom_fields->>'phone', l.custom_fields->>'Phone'),
  coalesce(l.custom_fields->>'companyName', l.custom_fields->>'company'),
  coalesce(
    l.custom_fields->>'Agent Profile',
    l.custom_fields->>'agentProfile',
    l.custom_fields->>'website'
  ),
  la.assigned_at
from label_assignments la
join labels lb on lb.id = la.label_id and lower(lb.name) = 'introduction'
join threads t on t.id = la.target_id
left join leads l on l.id = t.lead_id
where la.target_type = 'thread' and t.client_id is not null
on conflict (client_id, thread_id) do nothing;
