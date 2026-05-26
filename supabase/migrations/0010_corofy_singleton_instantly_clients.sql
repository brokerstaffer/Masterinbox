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
