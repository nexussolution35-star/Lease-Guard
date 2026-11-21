-- Reports: arrears and payment arrangements (ticket R-05, ADR 0003).
--
-- Three read-only reporting functions the reports service (services/reports) calls with the caller's own token. They
-- follow the conventions of 20261122020000_reports_service_access.sql: STABLE, SECURITY INVOKER (Row Level Security
-- applies to everything they read), executable by `authenticated` only, and they start with
-- private.reports_require_member, so another company's id is refused (42501) instead of answered with zeros.
-- They return rows; the reports themselves (ageing, arrangement suppression, schedule progress, totals, filters) are put
-- together by the domain rules in @leaseguard/domain (rules/arrearsReports.ts):
--
--   * public.reports_arrears_detail: the rows of public.reports_arrears_accounts (the latest verified statement of every
--     account, by the rules of dashboard_arrears_totals; zero and credit balances included) with the names the report
--     shows: the tenant's trading name, the property, the unit number and the lease reference. Reusing that function
--     keeps one definition of "the latest verified statement per account" for the dashboard, portfolio and arrears.
--   * public.reports_payment_arrangements: every payment arrangement of the company (proposed, active, completed,
--     defaulted, cancelled) with its names and its instalments (id, sequence, due date, amount, status) as a JSON array
--     in sequence order. Arrangements are monitoring records: nothing here was paid through LeaseGuard.
--   * public.reports_arrears_settings: the company's arrears and arrangement monitoring configuration, the configs of
--     its `arrears` and `arrangement_attention` monitoring rules (null without a rule), so the report ages balances into
--     the same buckets as the Statements page and the daily arrears monitoring, and counts an instalment as overdue
--     after the same grace days as the arrangement monitoring. The service validates the shape.
--
-- A monitoring report, never a transaction: nothing here writes.

-- --------------------------------------------------------------------------- arrears detail

create function public.reports_arrears_detail(p_company_id uuid)
returns table (
  tenant_id uuid,
  tenant_name text,
  property_id uuid,
  property_name text,
  unit_id uuid,
  unit_number text,
  lease_id uuid,
  lease_reference text,
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
  select
    a.tenant_id,
    t.trading_name,
    a.property_id,
    p.name,
    a.unit_id,
    un.unit_number,
    a.lease_id,
    le.reference,
    a.statement_id,
    a.statement_date,
    a.outstanding
  from public.reports_arrears_accounts(p_company_id) a
  join public.tenants t on t.company_id = p_company_id and t.id = a.tenant_id
  join public.properties p on p.company_id = p_company_id and p.id = a.property_id
  left join public.units un on un.company_id = p_company_id and un.id = a.unit_id
  left join public.leases le on le.company_id = p_company_id and le.id = a.lease_id
  order by a.outstanding desc, t.trading_name, a.statement_id;
end;
$$;
revoke all on function public.reports_arrears_detail(uuid) from public, anon;
grant execute on function public.reports_arrears_detail(uuid) to authenticated;
comment on function public.reports_arrears_detail(uuid) is
  'Reports service (R-05): the latest verified statement of every account (reports_arrears_accounts) with the tenant, '
  'property, unit and lease names; zero and credit balances included. Members only.';

-- --------------------------------------------------------------------------- payment arrangements

create function public.reports_payment_arrangements(p_company_id uuid)
returns table (
  arrangement_id uuid,
  tenant_id uuid,
  tenant_name text,
  property_id uuid,
  property_name text,
  unit_id uuid,
  unit_number text,
  lease_id uuid,
  lease_reference text,
  status public.arrangement_status,
  frequency public.installment_frequency,
  installment_amount numeric,
  outstanding_balance numeric,
  first_installment_date date,
  final_installment_date date,
  agreed_on date,
  closed_on date,
  suppress_arrears_reminders boolean,
  installments jsonb
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
    pa.id,
    pa.tenant_id,
    t.trading_name,
    pa.property_id,
    p.name,
    pa.unit_id,
    un.unit_number,
    pa.lease_id,
    le.reference,
    pa.status,
    pa.frequency,
    pa.installment_amount::numeric,
    pa.outstanding_balance::numeric,
    pa.first_installment_date,
    pa.final_installment_date,
    pa.agreed_on,
    pa.closed_on,
    pa.suppress_arrears_reminders,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'sequence', i.sequence, 'dueDate', i.due_date, 'amount', i.amount, 'status', i.status)
          order by i.sequence
        )
        from public.arrangement_installments i
        where i.company_id = p_company_id and i.arrangement_id = pa.id
      ),
      '[]'::jsonb
    )
  from public.payment_arrangements pa
  join public.tenants t on t.company_id = p_company_id and t.id = pa.tenant_id
  join public.properties p on p.company_id = p_company_id and p.id = pa.property_id
  join public.units un on un.company_id = p_company_id and un.id = pa.unit_id
  join public.leases le on le.company_id = p_company_id and le.id = pa.lease_id
  where pa.company_id = p_company_id
  order by pa.agreed_on desc, pa.id;
end;
$$;
revoke all on function public.reports_payment_arrangements(uuid) from public, anon;
grant execute on function public.reports_payment_arrangements(uuid) to authenticated;
comment on function public.reports_payment_arrangements(uuid) is
  'Reports service (R-05): every payment arrangement of the company with its tenant, property, unit and lease names and '
  'its instalments (JSON, in sequence order). Monitoring records only. Members only.';

-- --------------------------------------------------------------------------- arrears settings

create function public.reports_arrears_settings(p_company_id uuid)
returns table (arrears_config jsonb, arrangement_attention_config jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select
    (select r.config from public.monitoring_rules r where r.company_id = p_company_id and r.event_type = 'arrears'),
    (select r.config from public.monitoring_rules r where r.company_id = p_company_id and r.event_type = 'arrangement_attention');
end;
$$;
revoke all on function public.reports_arrears_settings(uuid) from public, anon;
grant execute on function public.reports_arrears_settings(uuid) to authenticated;
comment on function public.reports_arrears_settings(uuid) is
  'Reports service (R-05): the configs of the company''s arrears and arrangement_attention monitoring rules (null '
  'without a rule): the ageing buckets and the instalment grace days the reports use. Members only.';
