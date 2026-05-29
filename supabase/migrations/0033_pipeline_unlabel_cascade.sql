-- 0033: cascade pipeline-entry deletes when a thread is fully un-labeled.
--
-- Background: migration 0023 added an AFTER INSERT trigger on
-- label_assignments that creates a client_pipeline_entries row when
-- the "introduction" label is applied to a thread. There has never
-- been a matching DELETE cascade, so removing labels left the pipeline
-- entry in place forever (e.g. an internal OpsLabs test thread for
-- sankalp@outreachify.io kept appearing in Front Range Collective's
-- portal even after every label was cleared from the thread).
--
-- Why a CONSTRAINT TRIGGER (DEFERRABLE INITIALLY DEFERRED):
-- The single-label-per-thread label-picker (May 2026) implements a
-- label swap as DELETE-then-INSERT — see app/api/threads/[threadId]/
-- labels/route.ts. A row-level AFTER DELETE trigger that fires
-- immediately would see "zero labels left" in the brief window between
-- the two statements and incorrectly drop the pipeline row. Deferring
-- to commit time lets the swap settle, so we check the FINAL state of
-- the thread's labels and only cascade when the thread really is bare.

create or replace function public.client_pipeline_cleanup_on_unlabel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only thread-targeted assignments influence the pipeline.
  if old.target_type <> 'thread' then
    return null;
  end if;

  -- Deferred check: if the thread still has *any* label after the
  -- transaction settles, leave the pipeline entry alone. This is what
  -- protects label-swap flows (Introduction → Interested) from
  -- accidentally wiping live candidates.
  if exists (
    select 1
    from label_assignments la
    where la.target_type = 'thread'
      and la.target_id = old.target_id
  ) then
    return null;
  end if;

  delete from client_pipeline_entries
  where thread_id = old.target_id;

  return null;
end;
$$;

drop trigger if exists client_pipeline_cleanup_on_unlabel_trigger
  on label_assignments;

create constraint trigger client_pipeline_cleanup_on_unlabel_trigger
  after delete on label_assignments
  deferrable initially deferred
  for each row execute function public.client_pipeline_cleanup_on_unlabel();

-- One-time cleanup of rows that have already been orphaned by past
-- un-labeling. Same rule as the trigger: if the underlying thread has
-- zero labels right now, the pipeline entry isn't tracking anything
-- and should go. Entries without a thread_id (legacy / external_intros
-- backfill) are kept — the trigger only governs label-driven rows.
delete from client_pipeline_entries cpe
where cpe.thread_id is not null
  and not exists (
    select 1
    from label_assignments la
    where la.target_type = 'thread'
      and la.target_id = cpe.thread_id
  );
