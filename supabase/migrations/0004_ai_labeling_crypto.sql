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
