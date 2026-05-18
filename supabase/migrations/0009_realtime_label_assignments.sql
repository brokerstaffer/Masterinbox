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
