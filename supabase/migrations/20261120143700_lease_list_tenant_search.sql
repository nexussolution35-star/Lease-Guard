-- Lease list search by tenant (Module 5 / 03).
--
-- `GET /leases?search=` matches the lease reference or the tenant's trading or legal name. PostgREST cannot
-- put an embedded table's column inside a top-level `or` filter, so the tenant's names are exposed on
-- `leases` as a computed field: a function taking the lease row, which PostgREST treats as a column and
-- can filter on (`or=(reference.ilike.…,tenant_search_text.ilike.…)`).
--
-- SECURITY INVOKER: the tenants lookup runs under the caller's Row Level Security, so it never reveals a
-- tenant the caller cannot read. The company is matched as well as the id (leases_tenant_fk is composite).

create function public.tenant_search_text(lease public.leases)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select t.trading_name || ' ' || t.legal_name
  from public.tenants t
  where t.company_id = lease.company_id and t.id = lease.tenant_id
$$;

comment on function public.tenant_search_text(public.leases) is
  'Computed field for the lease list search: the lease tenant''s trading and legal names.';

revoke execute on function public.tenant_search_text(public.leases) from public, anon;
grant execute on function public.tenant_search_text(public.leases) to authenticated, service_role;
