-- 0039: capture the From header's display name on every inbound
-- message so the thread view can render it.
--
-- Background: the Instantly /emails endpoint returns
-- `from_address_json: [{name, address}]` for every message. EmailBison
-- carries a `from_name` field on replies. We've been discarding both
-- and falling back to either the lead's full_name (wrong for any
-- non-lead participant in the thread) or a titlecased local-part
-- ("growth@..." → "Growth", which loses "Howe Realty"). Storing the
-- actual display name on the row lets us render it directly.

alter table public.messages
  add column if not exists sender_name text;

-- Cheap secondary index for "any message lacking a sender_name we
-- could probably backfill" sweeps later on. Partial keeps it tiny
-- (zero rows once the backfill completes).
create index if not exists messages_sender_name_backfill_idx
  on public.messages (direction, source_provider)
  where sender_name is null and direction = 'inbound';
