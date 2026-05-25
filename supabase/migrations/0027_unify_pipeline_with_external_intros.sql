-- Unify the per-client pipeline with the legacy MasterInbox intros feed.
-- Until now client_pipeline_entries was populated only by a trigger on
-- label_assignments (the "Introduction" label), but the brokerages
-- almost never label by hand — the actual 144+ introductions per client
-- live in external_intros. This migration:
--
--   1. Adds external_intro_id on client_pipeline_entries so every
--      pipeline row can trace back to the originating intro feed entry.
--   2. Backfills one pipeline row per existing external_intros row,
--      mapping the enriched lead_detail JSON into the snapshot columns
--      (lead_name / brokerage / phone / profile url / introduced_at).
--   3. Installs a second trigger that fires on external_intros INSERT
--      so future syncs auto-create their pipeline rows.
--
-- The old label-driven trigger stays — labelled threads also create
-- pipeline rows, deduped by (client_id, thread_id).

-- 1) New column + partial unique index ---------------------------------

alter table public.client_pipeline_entries
  add column if not exists external_intro_id uuid
    references public.external_intros(id) on delete set null;

create unique index if not exists client_pipeline_entries_external_unique
  on public.client_pipeline_entries(client_id, external_intro_id)
  where external_intro_id is not null;


-- 2) Backfill from existing external_intros ----------------------------
-- Skip intros that already have a matching pipeline row (we run this
-- migration idempotently; the partial unique handles the conflict).

insert into public.client_pipeline_entries (
  client_id,
  external_intro_id,
  stage,
  lead_name,
  lead_email,
  lead_phone,
  current_brokerage,
  agent_profile_url,
  introduced_at
)
select
  ei.client_id,
  ei.id,
  'introduction'::pipeline_stage,
  coalesce(nullif(ei.name, ''), null),
  ei.email,
  nullif(ei.lead_detail #>> '{custom_fields,phone}', ''),
  nullif(ei.lead_detail ->> 'company', ''),
  nullif(ei.lead_detail #>> '{custom_fields,website}', ''),
  ei.intro_at
from public.external_intros ei
where ei.client_id is not null
on conflict (client_id, external_intro_id)
  where external_intro_id is not null
  do nothing;


-- 3) Trigger: every new external_intros row → a pipeline row -----------

create or replace function public.client_pipeline_on_external_intro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null then
    return new;
  end if;

  insert into public.client_pipeline_entries (
    client_id,
    external_intro_id,
    stage,
    lead_name,
    lead_email,
    lead_phone,
    current_brokerage,
    agent_profile_url,
    introduced_at
  ) values (
    new.client_id,
    new.id,
    'introduction'::pipeline_stage,
    nullif(new.name, ''),
    new.email,
    nullif(new.lead_detail #>> '{custom_fields,phone}', ''),
    nullif(new.lead_detail ->> 'company', ''),
    nullif(new.lead_detail #>> '{custom_fields,website}', ''),
    new.intro_at
  )
  on conflict (client_id, external_intro_id)
    where external_intro_id is not null
    do nothing;

  return new;
end;
$$;

drop trigger if exists client_pipeline_external_intro_trigger
  on public.external_intros;
create trigger client_pipeline_external_intro_trigger
  after insert on public.external_intros
  for each row execute function public.client_pipeline_on_external_intro();
