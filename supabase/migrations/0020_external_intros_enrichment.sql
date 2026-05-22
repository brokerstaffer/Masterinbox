-- 0020: lead-detail enrichment for external_intros.
--
-- The legacy MasterInbox feed only carries email / name / campaign. To
-- show the full lead profile in the portal, the sync now enriches each
-- row from the Instantly API (POST /leads/list) — company, title and
-- every campaign custom variable (phone, location, website, …).
--
--   lead_detail  jsonb  — { company, title, custom_fields: { … } }
--   enriched_at         — when the Instantly lookup last ran. NULL =
--                         pending; it's set even on a "not found" so a
--                         missing lead isn't retried on every sync.

alter table external_intros
  add column if not exists lead_detail jsonb not null default '{}'::jsonb,
  add column if not exists enriched_at timestamptz;

create index if not exists external_intros_enriched_idx
  on external_intros (enriched_at);
