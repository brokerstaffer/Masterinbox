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
