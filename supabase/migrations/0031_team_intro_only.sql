-- 0031: re-orient Team from blocklist to intro-notification roster.
--
-- Team was originally a second blocklist surface — adding a team member
-- pushed their email to Instantly + EmailBison so we never accidentally
-- emailed our own staff. Client feedback (May 2026) said Team should be
-- ONLY about who receives intro notifications. Add the phone column the
-- new UX needs; keep the legacy push columns in place (pushed_to_*,
-- push_error) so existing rows don't break — we just stop writing them
-- from the API.

alter table public.client_team_members
  add column if not exists phone text;
