-- Drops the unused Unipile/LinkedIn integration columns and indexes.
-- LinkedIn URL on leads is intentionally KEPT (used for socials display in the
-- prospect panel). The channel_type / channel_provider / label_platform enums
-- still carry 'linkedin'/'unipile' values — those are invisible to users and
-- removing enum values requires a full rebuild, so we leave them alone.

-- ---- channels: drop unipile mirror columns + indexes ----
drop index if exists channels_unipile_unique;
alter table channels drop column if exists unipile_account_id;

-- ---- leads: drop unipile attendee mirror, KEEP linkedin_url ----
drop index if exists leads_unipile_unique;
alter table leads drop column if exists unipile_attendee_id;

-- ---- threads: drop unipile chat mirror ----
drop index if exists threads_unipile_unique;
alter table threads drop column if exists unipile_chat_id;

-- ---- messages: drop unipile message mirror ----
alter table messages drop column if exists unipile_message_id;

-- ---- reply_agents: drop 'linkedin' from channel_filter check ----
alter table reply_agents
  drop constraint if exists reply_agents_channel_filter_check;
alter table reply_agents
  add constraint reply_agents_channel_filter_check
  check (channel_filter in ('email', 'both'));

-- ---- labels: prevent any new 'linkedin' platform inserts ----
-- label_platform is a pg enum so we can't alter the constraint directly. Any
-- existing rows with platform='linkedin' (none expected in this fresh BrokerStaffer
-- DB) are coerced to 'both' so they remain visible.
update labels set platform = 'both' where platform::text = 'linkedin';
