-- Per-client feature flags for the Client Portal.
--
-- Lets us ship a new feature globally but only have it light up
-- for a "test" client until we're ready to roll out to everyone.
-- The matching application code reads the column defensively
-- (see resolvePortalClient in lib/portals/token.ts) so portals
-- continue to render normally even if this migration hasn't been
-- applied yet. That's intentional: the order of operations is
-- "apply this migration to live, then deploy the code", but the
-- code path is engineered so the WRONG order is still a no-op
-- rather than an outage.
--
-- Shape mirrors clients.stage_label_overrides (jsonb, default {}).
-- Empty {} on every existing row = same behaviour as today.

alter table clients
  add column if not exists feature_flags jsonb
    not null default '{}'::jsonb;
