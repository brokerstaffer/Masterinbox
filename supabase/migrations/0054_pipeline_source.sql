-- Per-entry source tag on client_pipeline_entries.
--
-- We send a `source` to FollowUpBoss on every push event (see
-- lib/integrations/followup-boss.ts pushPersonEvent). Until now it
-- was hardcoded to "BrokerStaffer" because every pipeline entry
-- traced back to Nicole's email introductions. Splitting it lets
-- clients log leads they sourced themselves and have FUB record
-- the right origin.
--
-- Default is 'BrokerStaffer' so:
--   • every existing row backfills to the correct historical value
--     (which IS what FUB recorded for them — no rewrite needed)
--   • the trigger-driven inserts in 0023 / 0027 (introduction
--     label + external_intros) inherit BrokerStaffer for free
--     without needing changes
--   • the column is non-null so the application layer can rely
--     on always having a value to forward to FUB
--
-- No CHECK constraint on the value: we want to be able to add
-- "Referral", "Event", etc. later without another migration. The
-- application validates the known set ("BrokerStaffer", "Client
-- Entry") at write time. A bad value would still push to FUB
-- successfully — FUB accepts any string as `source`.

alter table client_pipeline_entries
  add column if not exists source text
    not null default 'BrokerStaffer';
