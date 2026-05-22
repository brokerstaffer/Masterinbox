-- 0022: template categories.
--
-- Lets reply templates be organised into named folders. A category is
-- just a free-text label on the template — "create a category" simply
-- means typing a new name. NULL = uncategorised.

alter table reply_templates
  add column if not exists category text;

create index if not exists reply_templates_category_idx
  on reply_templates (workspace_id, category);
