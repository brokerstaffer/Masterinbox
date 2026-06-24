-- Ideal Agent Profile — per-client recruiting target spec.
--
-- Stores the brokerage's answers about what kind of agent they
-- want us to source: production range, MLS membership, target
-- markets, years of experience, plus a free-text "additional
-- criteria" notes field. Captured today via the in-portal form
-- on the Demo Portal (gated by feature_flags.ideal_agent_profile);
-- typeform sync that writes the same JSONB shape lands later.
--
-- Shape mirrors clients.feature_flags (jsonb, default {}). Empty
-- {} on every existing row = same behaviour as today. The matching
-- application code reads the column defensively (see resolvePortalClient
-- in lib/portals/token.ts) so portals keep rendering normally even
-- if this migration hasn't been applied yet — same order-of-operations
-- safety contract as 0053.

alter table clients
  add column if not exists ideal_agent_profile jsonb
    not null default '{}'::jsonb;
