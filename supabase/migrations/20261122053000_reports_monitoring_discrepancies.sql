-- Reports: lease monitoring and rental discrepancies (ticket R-02, ADR 0003).
--
-- Three read-only reporting functions the reports service (services/reports) calls with the caller's own token. They
-- follow the conventions of 20261122020000_reports_service_access.sql: STABLE, SECURITY INVOKER (Row Level Security
-- applies to everything they read), executable by `authenticated` only, and they start with
-- private.reports_require_member, so another company's id is refused (42501) instead of answered with nothing.
-- They return rows; the reports themselves (open events, ages, the rental comparison, totals, filters) are put together
-- by the domain rules in @leaseguard/domain (rules/monitoringReports.ts), the rules monitoring itself uses:
--
--   * public.reports_monitoring_events: every monitoring event of the company (archived properties included, as the
--     dashboard counts them), with the names of its property, unit and tenant, its explainable calculation and, when it
--     names a statement, that statement's date and billed period start.
--   * public.reports_rental_comparisons: every lease in a monitored status (active, expiring: the domain
--     MONITORED_LEASE_STATUSES; the database keeps those verified, leases_live_status_verified_check) and every lease
--     still waiting for verification (draft, pending_verification: the report counts them as excluded, as the portfolio
--     overview counts unverified leases), with its escalation terms and the latest verified statement of the lease that
--     bills rental, chosen as the lease monitoring scan chooses it (backend lease-monitoring.processor.ts): verified
--     statements of the lease with a rental charged, the latest statement date, on the same date the lowest id.
--   * public.reports_discrepancy_rule: the company's rental escalation discrepancy rule (enabled flag and config, whose
--     tolerance the comparison uses), or no row when the company has none (the monitoring defaults apply).
--
-- A monitoring report, never a transaction: nothing here writes.

-- --------------------------------------------------------------------------- monitoring events

create function public.reports_monitoring_events(p_company_id uuid)
returns table (
  event_id uuid,
  event_type public.monitoring_event_type,
  title text,
  priority public.event_priority,
  status public.monitoring_event_status,
  property_id uuid,
  property_name text,
  unit_number text,
  tenant_id uuid,
  tenant_name text,
  lease_id uuid,
  lease_reference text,
  statement_id uuid,
  statement_date date,
  statement_period_start date,
  identified_on date,
  due_date date,
  calculation jsonb
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
    me.id,
    me.type,
    me.title,
    me.priority,
    me.status,
    me.property_id,
    p.name,
    un.unit_number,
    me.tenant_id,
    t.trading_name,
    me.lease_id,
    coalesce(me.lease_reference, le.reference),
    me.statement_id,
    s.statement_date,
    s.period_start,
    me.identified_on,
    me.due_date,
    me.calculation
  from public.monitoring_events me
  join public.properties p on p.company_id = me.company_id and p.id = me.property_id
  left join public.units un on un.company_id = me.company_id and un.id = me.unit_id
  left join public.tenants t on t.company_id = me.company_id and t.id = me.tenant_id
  left join public.leases le on le.company_id = me.company_id and le.id = me.lease_id
  left join public.statements s on s.company_id = me.company_id and s.id = me.statement_id
  where me.company_id = p_company_id
  order by me.identified_on, me.id;
end;
$$;
revoke all on function public.reports_monitoring_events(uuid) from public, anon;
grant execute on function public.reports_monitoring_events(uuid) to authenticated;
comment on function public.reports_monitoring_events(uuid) is
  'Reports service (R-02): every monitoring event of the company with its property, unit and tenant names, its '
  'calculation and the date and billed period of the statement it names. Members only.';

-- --------------------------------------------------------------------------- rental comparisons

create function public.reports_rental_comparisons(p_company_id uuid)
returns table (
  lease_id uuid,
  lease_reference text,
  lease_status public.lease_status,
  verified boolean,
  property_id uuid,
  property_name text,
  unit_number text,
  tenant_id uuid,
  tenant_name text,
  commencement_date date,
  expiry_date date,
  initial_monthly_rental numeric,
  escalation_type public.escalation_type,
  escalation_percentage numeric,
  escalation_fixed_amount numeric,
  escalation_cpi_assumed_percentage numeric,
  escalation_cpi_margin_percentage numeric,
  escalation_frequency public.escalation_frequency,
  first_escalation_date date,
  statement_id uuid,
  statement_date date,
  period_start date,
  rental_charged numeric
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
    le.id,
    le.reference,
    le.status,
    le.verified,
    le.property_id,
    p.name,
    un.unit_number,
    le.tenant_id,
    t.trading_name,
    le.commencement_date,
    le.expiry_date,
    le.initial_monthly_rental::numeric,
    le.escalation_type,
    le.escalation_percentage::numeric,
    le.escalation_fixed_amount::numeric,
    le.escalation_cpi_assumed_percentage::numeric,
    le.escalation_cpi_margin_percentage::numeric,
    le.escalation_frequency,
    le.first_escalation_date,
    billed.id,
    billed.statement_date,
    billed.period_start,
    billed.rental_charged::numeric
  from public.leases le
  join public.properties p on p.company_id = le.company_id and p.id = le.property_id
  join public.tenants t on t.company_id = le.company_id and t.id = le.tenant_id
  left join public.units un on un.company_id = le.company_id and un.id = le.unit_id
  left join lateral (
    select s.id, s.statement_date, s.period_start, s.rental_charged
    from public.statements s
    where s.company_id = le.company_id
      and s.lease_id = le.id
      and s.status = 'verified'
      and s.rental_charged is not null
      and s.statement_date is not null
      and s.period_start is not null
    order by s.statement_date desc, s.id
    limit 1
  ) billed on true
  where le.company_id = p_company_id
    and le.status in ('active', 'expiring', 'draft', 'pending_verification')
  order by p.name, le.reference, le.id;
end;
$$;
revoke all on function public.reports_rental_comparisons(uuid) from public, anon;
grant execute on function public.reports_rental_comparisons(uuid) to authenticated;
comment on function public.reports_rental_comparisons(uuid) is
  'Reports service (R-02): every lease of the company in a monitored status (active, expiring) or waiting for '
  'verification (draft, pending_verification), with its escalation terms and its latest verified statement that bills '
  'rental (as the lease monitoring scan picks it). Members only.';

-- --------------------------------------------------------------------------- discrepancy rule

create function public.reports_discrepancy_rule(p_company_id uuid)
returns table (
  enabled boolean,
  config jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select mr.enabled, mr.config
  from public.monitoring_rules mr
  where mr.company_id = p_company_id
    and mr.event_type = 'rental_escalation_discrepancy'
  order by mr.id
  limit 1;
end;
$$;
revoke all on function public.reports_discrepancy_rule(uuid) from public, anon;
grant execute on function public.reports_discrepancy_rule(uuid) to authenticated;
comment on function public.reports_discrepancy_rule(uuid) is
  'Reports service (R-02): the company''s rental escalation discrepancy monitoring rule (enabled flag and config with '
  'its tolerance), or no row when it has none. Members only.';
