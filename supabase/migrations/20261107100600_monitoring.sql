-- Monitoring rules and the events they raise.

-- Validates MonitoringRuleConfig (a discriminated union on `kind`, camelCase keys as in the domain
-- type). Only the shape is checked here; the rule logic lives in @leaseguard/domain.
create function private.is_valid_monitoring_rule_config(p_event_type public.monitoring_event_type, p_config jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_config) = 'object'
    and p_config ->> 'kind' = p_event_type::text
    and case p_event_type
      when 'rental_escalation_discrepancy' then
        jsonb_typeof(p_config -> 'toleranceRands') = 'number' and jsonb_typeof(p_config -> 'tolerancePercent') = 'number'
      when 'lease_expiry' then jsonb_typeof(p_config -> 'noticeDays') = 'array'
      when 'renewal_notice_deadline' then jsonb_typeof(p_config -> 'warningDays') = 'array'
      when 'guarantee_expiry' then jsonb_typeof(p_config -> 'noticeDays') = 'array'
      when 'guarantee_shortfall' then
        jsonb_typeof(p_config -> 'minimumCoverageMonths') = 'number' and jsonb_typeof(p_config -> 'toleranceRands') = 'number'
      when 'deposit_shortfall' then jsonb_typeof(p_config -> 'minimumCoverageMonths') = 'number'
      when 'arrears' then
        jsonb_typeof(p_config -> 'minimumBalanceRands') = 'number' and jsonb_typeof(p_config -> 'ageingBucketsDays') = 'array'
      when 'arrangement_attention' then jsonb_typeof(p_config -> 'graceDays') = 'number'
      when 'statement_review_required' then
        jsonb_typeof(p_config -> 'confidenceThreshold') = 'number'
        and (p_config ->> 'confidenceThreshold')::numeric between 0 and 1
    end
$$;

create table public.monitoring_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  event_type public.monitoring_event_type not null,
  name text not null,
  description text not null,
  enabled boolean not null default true,
  default_priority public.event_priority not null,
  config jsonb not null,
  -- Property manager events are assigned to when raised by this rule.
  default_assignee_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitoring_rules_company_id_key unique (company_id, id),
  constraint monitoring_rules_company_event_type_key unique (company_id, event_type),
  constraint monitoring_rules_config_check check (private.is_valid_monitoring_rule_config(event_type, config)),
  constraint monitoring_rules_default_assignee_fk foreign key (company_id, default_assignee_user_id)
    references public.company_users (company_id, user_id)
);
create index monitoring_rules_default_assignee_idx on public.monitoring_rules (company_id, default_assignee_user_id) where default_assignee_user_id is not null;

create table public.monitoring_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.monitoring_event_type not null,
  property_id uuid not null,
  unit_id uuid,
  tenant_id uuid,
  lease_id uuid,
  lease_reference text,
  statement_id uuid,
  arrangement_id uuid,
  rule_id uuid,
  title text not null,
  description text not null,
  -- EventCalculation: { expectedAmount?, actualAmount?, difference?, steps[] }, explaining the figures.
  calculation jsonb check (calculation is null or jsonb_typeof(calculation -> 'steps') = 'array'),
  identified_on date not null,
  due_date date,
  priority public.event_priority not null,
  recommended_action text not null,
  assigned_to_user_id uuid,
  status public.monitoring_event_status not null default 'new',
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  resolution_notes text,
  dismissal_reason text,
  dismissed_by_user_id uuid,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitoring_events_company_id_key unique (company_id, id),
  constraint monitoring_events_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id),
  constraint monitoring_events_unit_fk foreign key (company_id, property_id, unit_id)
    references public.units (company_id, property_id, id),
  constraint monitoring_events_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id),
  constraint monitoring_events_lease_fk foreign key (company_id, lease_id)
    references public.leases (company_id, id),
  constraint monitoring_events_statement_fk foreign key (company_id, statement_id)
    references public.statements (company_id, id),
  constraint monitoring_events_arrangement_fk foreign key (company_id, arrangement_id)
    references public.payment_arrangements (company_id, id),
  constraint monitoring_events_rule_fk foreign key (company_id, rule_id)
    references public.monitoring_rules (company_id, id),
  constraint monitoring_events_assigned_to_fk foreign key (company_id, assigned_to_user_id)
    references public.company_users (company_id, user_id),
  constraint monitoring_events_resolved_by_fk foreign key (company_id, resolved_by_user_id)
    references public.company_users (company_id, user_id),
  constraint monitoring_events_dismissed_by_fk foreign key (company_id, dismissed_by_user_id)
    references public.company_users (company_id, user_id),
  -- A dismissal always records why and by whom.
  constraint monitoring_events_dismissal_check check (
    (status = 'dismissed') = (dismissal_reason is not null and dismissed_by_user_id is not null and dismissed_at is not null)
  ),
  constraint monitoring_events_resolution_check check (status <> 'resolved' or resolved_at is not null)
);
create index monitoring_events_company_status_idx on public.monitoring_events (company_id, status, priority);
create index monitoring_events_company_type_idx on public.monitoring_events (company_id, type, status);
create index monitoring_events_company_due_idx on public.monitoring_events (company_id, due_date) where due_date is not null;
create index monitoring_events_property_idx on public.monitoring_events (company_id, property_id);
create index monitoring_events_unit_idx on public.monitoring_events (company_id, property_id, unit_id) where unit_id is not null;
create index monitoring_events_tenant_idx on public.monitoring_events (company_id, tenant_id) where tenant_id is not null;
create index monitoring_events_lease_idx on public.monitoring_events (company_id, lease_id) where lease_id is not null;
create index monitoring_events_statement_idx on public.monitoring_events (company_id, statement_id) where statement_id is not null;
create index monitoring_events_arrangement_idx on public.monitoring_events (company_id, arrangement_id) where arrangement_id is not null;
create index monitoring_events_rule_idx on public.monitoring_events (company_id, rule_id) where rule_id is not null;
create index monitoring_events_assigned_to_idx on public.monitoring_events (company_id, assigned_to_user_id) where assigned_to_user_id is not null;
create index monitoring_events_resolved_by_idx on public.monitoring_events (company_id, resolved_by_user_id) where resolved_by_user_id is not null;
create index monitoring_events_dismissed_by_idx on public.monitoring_events (company_id, dismissed_by_user_id) where dismissed_by_user_id is not null;

-- Unverified lease terms are not financial evidence: events that compare money against lease terms
-- may only reference a verified lease.
create function private.require_verified_lease_for_financial_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type in ('rental_escalation_discrepancy', 'guarantee_shortfall', 'deposit_shortfall')
     and not exists (
       select 1 from public.leases l
       where l.company_id = new.company_id and l.id = new.lease_id and l.verified
     ) then
    raise exception '% events require a verified lease', new.type using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger require_verified_lease before insert or update of type, lease_id on public.monitoring_events
  for each row execute function private.require_verified_lease_for_financial_event();

create trigger set_updated_at before update on public.monitoring_rules
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.monitoring_rules
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.monitoring_events
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.monitoring_events
  for each row execute function private.prevent_company_change();
