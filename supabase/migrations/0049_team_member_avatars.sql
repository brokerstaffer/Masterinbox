-- Team-member profile pictures for the Client Portal.
--
-- Adds an optional photo URL on each team member + a public storage
-- bucket to host the bytes. The Avatar component falls back to the
-- name initials when avatar_url is null, so existing rows keep
-- rendering exactly as before.
--
-- Trust model mirrors the portal tokens themselves: the bucket is
-- public-read, but writes go through the admin Supabase client in
-- /api/portal/<token>/team/<id>/avatar (token-in-path validates the
-- caller). Paths are obfuscated with /<client_id>/<member_id>-<ts>.<ext>
-- so guessing one URL doesn't surface anyone else's photo.

alter table client_team_members
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('team-avatars', 'team-avatars', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'team-avatars service writes'
  ) then
    create policy "team-avatars service writes"
      on storage.objects
      for all
      to service_role
      using (bucket_id = 'team-avatars')
      with check (bucket_id = 'team-avatars');
  end if;
end $$;
