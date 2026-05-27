-- 0032: domain-level blocking for DNC companies.
--
-- When a DNC entry's kind = 'company', the value the client really
-- wants to block is the WHOLE DOMAIN, not just one email address. This
-- column captures the normalized domain (lower-case, no leading
-- `www.` / `@`). The email column stays nullable for agent rows and
-- as an optional contact email on company rows when the client supplies
-- one. Provider sync uses domain when present.

alter table public.client_dnc_entries
  add column if not exists domain text;

create index if not exists client_dnc_domain_idx
  on public.client_dnc_entries (lower(domain))
  where domain is not null;
