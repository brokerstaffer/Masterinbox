-- Per-pipeline-entry custom-field overrides.
--
-- The expanded candidate card in the client portal renders the raw
-- Bison/Instantly enrichment from leads.custom_fields (merged with
-- external_intros.lead_detail.custom_fields). Clients asked to be able
-- to correct those values from the portal's Edit dialog (Sales Volume,
-- MLS Affiliation, Office City, etc.).
--
-- We do NOT write those edits back to leads.custom_fields because:
--   • leads are keyed by person — a single lead row can be shared by
--     more than one client's pipeline entry, so an edit there would
--     leak across clients.
--   • it would destroy the original enrichment, and a future re-sync
--     could clobber the edit (or vice versa).
--
-- Instead every edit lands in this per-entry JSONB override map. At
-- display time portal-data merges it ON TOP of the raw enrichment
-- (override wins), so:
--   • edits are scoped to exactly one client's entry — never leak,
--   • the original Bison data is untouched and still the fallback,
--   • clearing an override key reverts that field to the source value.
--
-- Shape mirrors clients.feature_flags / stage_label_overrides:
-- jsonb, NOT NULL, default {}. Every existing row is byte-identical
-- (empty map = "no overrides" = same behaviour as before). Additive,
-- non-destructive; the reading code treats a missing/empty map as
-- "no overrides", so a deploy-before-migration accident degrades to
-- "no edits available" rather than an outage.

alter table client_pipeline_entries
  add column if not exists custom_fields_overrides jsonb
    not null default '{}'::jsonb;
