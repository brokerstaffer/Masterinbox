-- Follow Up Boss CRM integration for the Client Portal.
--
-- Each client connects their own FUB account via the portal
-- Settings page. The plaintext API key is stored on the clients
-- row for symmetry with portal_token. A Vault-backed encrypted
-- column is the right next step but is intentionally out of v1
-- scope to keep this self-contained.
--
-- Per-entry columns track whether a pipeline candidate has been
-- pushed to FUB so the auto-push hook can dedupe and the manual
-- "Push" button can surface error state.

alter table clients
  add column if not exists fub_api_key text,
  add column if not exists fub_connected_at timestamptz;

alter table client_pipeline_entries
  add column if not exists fub_event_id text,
  add column if not exists fub_pushed_at timestamptz,
  add column if not exists fub_last_error text;
