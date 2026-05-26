-- Reply templates: add subject / cc / bcc / body_html so a template can
-- pre-fill the full composer (not just the body), and store rich-text
-- formatted bodies alongside the plain-text fallback.
--
-- Existing `body` column stays — it continues to hold the plain-text
-- version for legacy callers and is auto-derived from `body_html` when
-- a richer template is saved.
--
-- All new columns are nullable so existing rows stay valid.

alter table public.reply_templates
  add column if not exists subject   text,
  add column if not exists cc        text,
  add column if not exists bcc       text,
  add column if not exists body_html text;
