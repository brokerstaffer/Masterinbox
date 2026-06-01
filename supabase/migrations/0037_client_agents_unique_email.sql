-- 0037: enforce one client_agents row per (client_id, email).
--
-- Background: the CSV upload path used to insert one row at a time
-- with a per-row provider push. A 300-row import took >75s and
-- operators commonly re-uploaded after the page felt frozen, which
-- duplicated every row that was already inserted before the retry
-- (no DB-side dedup). The route is being switched to a single
-- batched `upsert(..., { onConflict: "client_id,email" })` call; this
-- migration backs that with a unique partial index, plus normalises
-- already-stored emails to lowercase so re-imports stay idempotent.

-- 1. Normalize existing emails so the unique index doesn't trip on
--    "Foo@x.com" vs "foo@x.com" duplicates introduced by past uploads.
update public.client_agents
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

-- 2. Drop any duplicate rows that the normalization above would
--    surface. Keep the oldest row per (client_id, email).
delete from public.client_agents a
using public.client_agents b
where a.client_id = b.client_id
  and a.email is not null
  and b.email is not null
  and a.email = b.email
  and a.created_at > b.created_at;

-- 3. Add the partial unique index that backs the CSV upsert.
create unique index if not exists client_agents_unique_email
  on public.client_agents (client_id, email)
  where email is not null;
