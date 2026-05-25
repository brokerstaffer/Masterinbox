-- Single-RPC version of the portal-counts query that previously fired
-- four parallel PostgREST count(head) requests per page render. One
-- round-trip is cheaper now that Supabase and Railway are co-located
-- in us-east, and gives the sidebar pills + admin overview a stable
-- shape.

create or replace function public.portal_counts(client_uuid uuid)
returns table (
  pipeline integer,
  dnc integer,
  agents integer,
  team integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from client_pipeline_entries where client_id = client_uuid),
    (select count(*)::int from client_dnc_entries       where client_id = client_uuid),
    (select count(*)::int from client_agents            where client_id = client_uuid),
    (select count(*)::int from client_team_members      where client_id = client_uuid and active);
$$;

revoke all on function public.portal_counts(uuid) from public;
grant execute on function public.portal_counts(uuid) to service_role;
