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
