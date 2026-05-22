-- 0021: cached Instantly subsequence membership per thread.
--
-- The prospect panel shows whether a lead is already in a subsequence.
-- Reading that live from the Instantly API on every panel open is slow
-- and rate-limited, so we mirror it onto the thread:
--
--   subsequence_id        — the subsequence the lead currently sits in
--                           (null = not in one)
--   subsequence_name      — resolved display name
--   subsequence_added_at  — when Instantly added them
--   subsequence_synced_at — when we last refreshed this from Instantly
--                           (null = never synced; the route then does a
--                           live fetch and fills it in)

alter table threads
  add column if not exists subsequence_id text,
  add column if not exists subsequence_name text,
  add column if not exists subsequence_added_at timestamptz,
  add column if not exists subsequence_synced_at timestamptz;
