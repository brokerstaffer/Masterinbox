-- Auto-saved user-typed reply drafts (Composer state persistence).
--
-- Separate from `reply_drafts` (which is the AI-generated draft
-- table from migration 0001). Mixing the two would force
-- "is this draft user-edited or AI-suggested?" semantics onto a
-- single row and confuse the send-flow that marks AI drafts as
-- "sent" by status enum. Cleaner to keep concerns separate.
--
-- Shared across the workspace (no user_id column) — matches
-- reply_drafts' workspace-level scoping. If teammate A starts
-- typing and teammate B opens the thread, B sees A's in-progress
-- reply (last-write-wins reconciliation on reload). The inbox is
-- a shared team surface, so this is the right unit of ownership.
--
-- Application layer NEVER errors on missing-column / table-not-
-- present today; the thread loader wraps the SELECT in a try and
-- falls back to null. Migration can land before the code deploy.
--
-- Files (attachments) intentionally NOT persisted — re-hydrating
-- storage references is enough work to bundle separately. User
-- re-attaches on resume.

create table if not exists composer_drafts (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null
                      references workspaces(id) on delete cascade,
  thread_id           uuid not null
                      references threads(id) on delete cascade,
  -- Composer fields — saved verbatim from the in-memory composer
  -- state at debounce or unmount time.
  subject             text,
  body_html           text,
  body_text           text,
  to_addresses        text,
  cc_addresses        text,
  bcc_addresses       text,
  selected_channel_id uuid,
  add_signature       boolean not null default true,
  updated_at          timestamptz not null default now(),
  -- One draft per (workspace, thread). UPSERT target.
  unique (workspace_id, thread_id)
);

create index if not exists composer_drafts_thread_id_idx
  on composer_drafts(thread_id);
