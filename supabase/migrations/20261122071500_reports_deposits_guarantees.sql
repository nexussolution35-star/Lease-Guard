-- Reports: deposits and guarantees (ticket R-04, ADR 0003).
--
-- Two read-only reporting functions the reports service (services/reports) calls with the caller's own token. They
-- follow the conventions of 20261122020000_reports_service_access.sql: STABLE, SECURITY INVOKER (Row Level Security
-- applies to everything they read), executable by `authenticated` only, and they start with
-- private.reports_require_member, so another company's id is refused (42501) instead of answered with nothing.
-- They return rows; the report itself (required cover, shortfall, expiry state, totals, filters) is put together by the
-- domain rules in @leaseguard/domain (rules/securityReports.ts) with the rules lease monitoring uses, so a row's figures
-- are the monitoring event's for the same lease on the same day:
--
--   * public.reports_lease_security: every lease of the company that carries a deposit (deposit_amount recorded) or a
--     bank guarantee, whatever its status and verification (the domain lists the verified, monitored ones and counts
--     the unverified ones it leaves out), with the terms the expected rental is worked out from (commencement, expiry,
--     initial rental, escalation), its deposit, its guarantee and the names of its tenant, property and unit.
--   * public.reports_guarantee_notice_days: the company's guarantee expiry notice days and the `noticeDays` of its
--     guarantee expiry monitoring rule, if it has one; the domain (guaranteeNoticeDaysFor) uses the rule's when they are
--     valid, else the company's, as lease monitoring does.
--
-- A monitoring report, never a transaction: nothing here writes.

-- --------------------------------------------------------------------------- lease security

create function public.reports_lease_security(p_company_id uuid)
returns table (
  lease_id uuid,
  reference text,
  lease_status public.lease_status,
  verified boolean,
  tenant_id uuid,
  tenant_name text,
  property_id uuid,
  property_name text,
  unit_id uuid,
  unit_number text,
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
  deposit_amount numeric,
  deposit_basis_months numeric,
  deposit_held_by public.deposit_holder,
  deposit_interest_bearing boolean,
  guarantee_bank text,
  guarantee_reference text,
  guarantee_amount numeric,
  guarantee_basis_months numeric,
  guarantee_issued_on date,
  guarantee_expires_on date,
  guarantee_status public.guarantee_status
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
    t.id,
    t.trading_name,
    p.id,
    p.name,
    un.id,
    un.unit_number,
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
    le.deposit_amount::numeric,
    le.deposit_basis_months::numeric,
    le.deposit_held_by,
    le.deposit_interest_bearing,
    g.bank,
    g.reference_number,
    g.amount::numeric,
    g.basis_months::numeric,
    g.issued_on,
    g.expires_on,
    g.status
  from public.leases le
  join public.properties p on p.company_id = le.company_id and p.id = le.property_id
  join public.units un on un.company_id = le.company_id and un.id = le.unit_id
  join public.tenants t on t.company_id = le.company_id and t.id = le.tenant_id
  left join public.lease_bank_guarantees g on g.company_id = le.company_id and g.lease_id = le.id
  where le.company_id = p_company_id
    and (le.deposit_amount is not null or g.id is not null)
  order by p.name, p.id, le.reference, le.id;
end;
$$;
revoke all on function public.reports_lease_security(uuid) from public, anon;
grant execute on function public.reports_lease_security(uuid) to authenticated;
comment on function public.reports_lease_security(uuid) is
  'Reports service (R-04): every lease of the company with a deposit or a bank guarantee, any status, with its terms, '
  'deposit, guarantee and the names of its tenant, property and unit. Members only.';

-- --------------------------------------------------------------------------- guarantee notice days

create function public.reports_guarantee_notice_days(p_company_id uuid)
returns table (
  company_notice_days integer[],
  rule_notice_days jsonb
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
    c.guarantee_expiry_notice_days,
    mr.config -> 'noticeDays'
  from public.companies c
  left join public.monitoring_rules mr on mr.company_id = c.id and mr.event_type = 'guarantee_expiry'
  where c.id = p_company_id;
end;
$$;
revoke all on function public.reports_guarantee_notice_days(uuid) from public, anon;
grant execute on function public.reports_guarantee_notice_days(uuid) to authenticated;
comment on function public.reports_guarantee_notice_days(uuid) is
  'Reports service (R-04): the company''s guarantee expiry notice days and its guarantee expiry rule''s noticeDays '
  '(null without a rule). Members only.';
