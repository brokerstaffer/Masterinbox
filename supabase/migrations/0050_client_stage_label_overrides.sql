-- Per-client pipeline stage label overrides for the Client Portal.
--
-- The pipeline_stage enum stays frozen in Postgres; this column
-- only stores DISPLAY overrides. Shape:
--   {"interview": "In-Person Meeting", "phone_screen": "Coffee chat"}
-- Empty {} (the default) means "use the stock labels for everything".
--
-- Stale or unknown keys are ignored by the UI layer (see
-- resolveStageLabels in lib/portals/portal-data.ts), so a future
-- enum change won't break already-saved overrides.

alter table clients
  add column if not exists stage_label_overrides jsonb
    not null default '{}'::jsonb;
