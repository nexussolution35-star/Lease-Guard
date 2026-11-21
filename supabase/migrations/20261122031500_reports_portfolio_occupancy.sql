-- Reports: portfolio overview and occupancy (ticket R-01, ADR 0003).
--
-- Three read-only reporting functions the reports service (services/reports) calls with the caller's own token. They
-- follow the conventions of 20261122020000_reports_service_access.sql: STABLE, SECURITY INVOKER (Row Level Security
-- applies to everything they read), executable by `authenticated` only, and they start with
-- private.reports_require_member, so another company's id is refused (42501) instead of answered with zeros.
-- They return rows; the reports themselves (totals, rates, filters) are put together by the domain rules in
-- @leaseguard/domain (rules/portfolioReports.ts), so the figures are counted the way the dashboard counts them:
--
--   * public.reports_property_figures: one row per property (archived ones included, flagged by their status): its
--     units, occupied units (occupancy_status = 'occupied', as the dashboard), vacant units, active leases (status 'active', as the
--     dashboard), leases whose terms are not verified yet, the monthly rental roll (current monthly rental of the active
--     leases whose terms are verified: only verified terms drive financial monitoring) and its open monitoring events
--     (new, under review, action required, in progress: the domain OPEN_EVENT_STATUSES).
--   * public.reports_arrears_accounts: the latest verified statement of every account, with the rules of
--     public.dashboard_arrears_totals (domain ageArrears): only verified statements with a tenant and a statement date;
--     an account is the tenant's unit (the lease when the statement names no unit); its latest statement by statement
--     date, on the same date the lowest id; the outstanding amount is the closing balance, else the total due, else
--     zero, rounded to cents. Zero and credit balances are returned too (they are not arrears; the domain leaves them
--     out), so a report can show an account's latest balance. Arrangements are not read: they never take a balance out.
--   * public.reports_unit_occupancy: every unit of a property that is not archived (the units the dashboard counts),
--     with its occupancy status and its current tenant: the current lease's tenant, else the tenant assigned to it
--     (units.current_tenant_id, derived in the database), and which of the two it is.
--
-- A monitoring report, never a transaction: nothing here writes.

-- --------------------------------------------------------------------------- property figures

create function public.reports_property_figures(p_company_id uuid)
returns table (
  property_id uuid,
  property_name text,
  property_code text,
  property_status public.property_status,
  unit_count bigint,
  occupied_units bigint,
  vacant_units bigint,
  active_leases bigint,
  unverified_leases bigint,
  monthly_rental_roll numeric,
  open_events bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select
    p.id,
    p.name,
    p.code,
    p.status,
    coalesce(u.unit_count, 0),
    coalesce(u.occupied_units, 0),
    coalesce(u.vacant_units, 0),
    coalesce(l.active_leases, 0),
    coalesce(l.unverified_leases, 0),
    coalesce(l.monthly_rental_roll, 0)::numeric,
    coalesce(e.open_events, 0)
  from public.properties p
  left join lateral (
    select
      count(*) as unit_count,
      count(*) filter (where un.occupancy_status = 'occupied') as occupied_units,
      count(*) filter (where un.occupancy_status = 'vacant') as vacant_units
    from public.units un
    where un.company_id = p_company_id and un.property_id = p.id
  ) u on true
  left join lateral (
    select
      count(*) filter (where le.status = 'active') as active_leases,
      count(*) filter (where not le.verified and le.status not in ('expired', 'renewed', 'terminated')) as unverified_leases,
      round(coalesce(sum(le.current_monthly_rental) filter (where le.status = 'active' and le.verified), 0), 2) as monthly_rental_roll
    from public.leases le
    where le.company_id = p_company_id and le.property_id = p.id
  ) l on true
  left join lateral (
    select count(*) as open_events
    from public.monitoring_events me
    where me.company_id = p_company_id and me.property_id = p.id
      and me.status in ('new', 'under_review', 'action_required', 'in_progress')
  ) e on true
  where p.company_id = p_company_id
  order by p.name, p.id;
end;
$$;
revoke all on function public.reports_property_figures(uuid) from public, anon;
grant execute on function public.reports_property_figures(uuid) to authenticated;
comment on function public.reports_property_figures(uuid) is
  'Reports service (R-01): per property of the company, archived included, its units, occupied and vacant units, active leases, '
  'leases not yet verified, monthly rental roll of active verified leases and open monitoring events. Members only.';

-- --------------------------------------------------------------------------- arrears accounts

create function public.reports_arrears_accounts(p_company_id uuid)
returns table (
  tenant_id uuid,
  property_id uuid,
  unit_id uuid,
  lease_id uuid,
  statement_id uuid,
  statement_date date,
  outstanding numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select distinct on (s.tenant_id, coalesce('unit:' || s.unit_id::text, 'lease:' || coalesce(s.lease_id::text, '')))
    s.tenant_id,
    s.property_id,
    s.unit_id,
    s.lease_id,
    s.id,
    s.statement_date,
    round(coalesce(s.closing_balance, s.total_due, 0), 2)::numeric
  from public.statements s
  where s.company_id = p_company_id
    and s.status = 'verified'
    and s.tenant_id is not null
    and s.statement_date is not null
  order by s.tenant_id, coalesce('unit:' || s.unit_id::text, 'lease:' || coalesce(s.lease_id::text, '')), s.statement_date desc, s.id;
end;
$$;
revoke all on function public.reports_arrears_accounts(uuid) from public, anon;
grant execute on function public.reports_arrears_accounts(uuid) to authenticated;
comment on function public.reports_arrears_accounts(uuid) is
  'Reports service (R-01): the latest verified statement of every account (the tenant''s unit, else the lease) with '
  'its outstanding amount, by the rules of dashboard_arrears_totals; zero and credit balances included. Members only.';

-- --------------------------------------------------------------------------- unit occupancy

create function public.reports_unit_occupancy(p_company_id uuid)
returns table (
  unit_id uuid,
  unit_number text,
  unit_type public.unit_type,
  floor_area_sqm numeric,
  occupancy_status public.occupancy_status,
  property_id uuid,
  property_name text,
  tenant_id uuid,
  tenant_name text,
  tenant_source text,
  lease_id uuid,
  lease_reference text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select
    un.id,
    un.unit_number,
    un.type,
    un.floor_area_sqm::numeric,
    un.occupancy_status,
    p.id,
    p.name,
    t.id,
    t.trading_name,
    case when un.current_lease_id is not null then 'lease' when un.current_tenant_id is not null then 'assignment' end,
    le.id,
    le.reference
  from public.units un
  join public.properties p on p.company_id = un.company_id and p.id = un.property_id
  left join public.tenants t on t.company_id = un.company_id and t.id = un.current_tenant_id
  left join public.leases le on le.company_id = un.company_id and le.id = un.current_lease_id
  where un.company_id = p_company_id
    and p.status <> 'archived'
  order by p.name, p.id, un.unit_number, un.id;
end;
$$;
revoke all on function public.reports_unit_occupancy(uuid) from public, anon;
grant execute on function public.reports_unit_occupancy(uuid) to authenticated;
comment on function public.reports_unit_occupancy(uuid) is
  'Reports service (R-01): every unit of the company''s properties that are not archived, with its occupancy status and '
  'its current tenant (the current lease''s tenant, else the assigned tenant) and which one it is. Members only.';
