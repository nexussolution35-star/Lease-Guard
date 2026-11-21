-- Reports: lease expiry and renewal deadlines (ticket R-03, ADR 0003).
--
-- Two read-only reporting functions the reports service (services/reports) calls with the caller's own token. They
-- follow the conventions of 20261122020000_reports_service_access.sql: STABLE, SECURITY INVOKER (Row Level Security
-- applies to everything they read), executable by `authenticated` only, and they start with
-- private.reports_require_member, so another company's id is refused (42501) instead of answered with nothing.
-- They return rows; the reports themselves (buckets, days left, deadlines, warnings, filters) are put together by the
-- domain rules in @leaseguard/domain (rules/leaseDateReports.ts) with the rules lease monitoring uses:
--
--   * public.reports_lease_dates: every lease of the company that has not ended (status not expired, renewed or
--     terminated), verified or not (the domain reports only verified leases in a monitored status and counts the
--     others as excluded), with its tenant, property and unit, expiry date, current monthly rental, renewal option
--     (exists, exercised, notice period in months) and the id of its open lease-expiry and open renewal-notice-
--     deadline monitoring event (new, under review, action required, in progress: OPEN_EVENT_STATUSES), the most
--     recently identified one when there are several.
--   * public.reports_lease_date_settings: the company's thresholds as monitoring applies them
--     (backend/src/common/monitoring/monitoring-settings.ts): the monitoring rule's own days when the company has a
--     rule for the event type, else the company's settings (lease_expiry_notice_days,
--     renewal_deadline_warning_days); null when the company switched the rule off.
--
-- A monitoring report, never a transaction: nothing here writes.

-- --------------------------------------------------------------------------- lease dates

create function public.reports_lease_dates(p_company_id uuid)
returns table (
  lease_id uuid,
  lease_reference text,
  lease_status public.lease_status,
  verified boolean,
  tenant_id uuid,
  tenant_name text,
  property_id uuid,
  property_name text,
  unit_id uuid,
  unit_number text,
  expiry_date date,
  current_monthly_rental numeric,
  renewal_option_exists boolean,
  renewal_exercised boolean,
  renewal_notice_period_months integer,
  open_expiry_event_id uuid,
  open_renewal_event_id uuid
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
    le.expiry_date,
    le.current_monthly_rental::numeric,
    le.renewal_option_exists,
    le.renewal_exercised,
    le.renewal_notice_period_months::integer,
    (select me.id from public.monitoring_events me
      where me.company_id = p_company_id and me.lease_id = le.id and me.type = 'lease_expiry'
        and me.status in ('new', 'under_review', 'action_required', 'in_progress')
      order by me.identified_on desc, me.id limit 1),
    (select me.id from public.monitoring_events me
      where me.company_id = p_company_id and me.lease_id = le.id and me.type = 'renewal_notice_deadline'
        and me.status in ('new', 'under_review', 'action_required', 'in_progress')
      order by me.identified_on desc, me.id limit 1)
  from public.leases le
  join public.tenants t on t.company_id = le.company_id and t.id = le.tenant_id
  join public.properties p on p.company_id = le.company_id and p.id = le.property_id
  join public.units un on un.company_id = le.company_id and un.id = le.unit_id
  where le.company_id = p_company_id
    and le.status not in ('expired', 'renewed', 'terminated')
  order by le.expiry_date, le.reference, le.id;
end;
$$;
revoke all on function public.reports_lease_dates(uuid) from public, anon;
grant execute on function public.reports_lease_dates(uuid) to authenticated;
comment on function public.reports_lease_dates(uuid) is
  'Reports service (R-03): every lease of the company that has not ended, verified or not, with its tenant, property, '
  'unit, expiry date, current rental, renewal option and its open lease-expiry and renewal-deadline events. Members only.';

-- --------------------------------------------------------------------------- monitoring thresholds

create function public.reports_lease_date_settings(p_company_id uuid)
returns table (
  lease_expiry_notice_days integer[],
  renewal_warning_days integer[]
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
    case
      when er.id is null then c.lease_expiry_notice_days
      when not er.enabled then null
      when jsonb_typeof(er.config -> 'noticeDays') = 'array'
        then array(select d::integer from jsonb_array_elements_text(er.config -> 'noticeDays') d)
      else c.lease_expiry_notice_days
    end,
    case
      when rr.id is null then c.renewal_deadline_warning_days
      when not rr.enabled then null
      when jsonb_typeof(rr.config -> 'warningDays') = 'array'
        then array(select d::integer from jsonb_array_elements_text(rr.config -> 'warningDays') d)
      else c.renewal_deadline_warning_days
    end
  from public.companies c
  left join public.monitoring_rules er on er.company_id = c.id and er.event_type = 'lease_expiry'
  left join public.monitoring_rules rr on rr.company_id = c.id and rr.event_type = 'renewal_notice_deadline'
  where c.id = p_company_id;
end;
$$;
revoke all on function public.reports_lease_date_settings(uuid) from public, anon;
grant execute on function public.reports_lease_date_settings(uuid) to authenticated;
comment on function public.reports_lease_date_settings(uuid) is
  'Reports service (R-03): the company''s lease-expiry notice and renewal warning thresholds in days as monitoring '
  'applies them (the monitoring rule''s days, else the company settings); null for a rule switched off. Members only.';
