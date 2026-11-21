-- Reports: statement processing and communication activity (ticket R-06, ADR 0003).
--
-- Three read-only reporting functions the reports service (services/reports) calls with the caller's own token. They
-- follow the conventions of 20261122020000_reports_service_access.sql: STABLE, SECURITY INVOKER (Row Level Security
-- applies to everything they read), executable by `authenticated` only, and they start with
-- private.reports_require_member, so another company's id is refused (42501) instead of answered with zeros.
-- They return rows; the reports themselves (counts, backlog, ages, outcomes, filters) are put together by the domain
-- rules in @leaseguard/domain (rules/statementCommunicationReports.ts), with the rules the Statements page, the review
-- screen, the dashboard and communication analytics use:
--
--   * public.reports_statement_uploads: every statement of the company (archived properties included, as the
--     dashboard's pending reviews count them), with its property, tenant and unit names, source system, status, upload
--     time and its South African upload date (Africa/Johannesburg, the report's date range), processing error, the
--     statement it duplicates and its extraction's overall confidence.
--   * public.reports_statement_review_fields: the extracted fields of the statements waiting for review (status
--     review_required), with what the domain's fieldResolution needs (value, flag, correction, confirmation) to count
--     the fields a reviewer still has to resolve.
--   * public.reports_communication_activity: every message of the company with its counterparty's name (the tenant's
--     trading name, the owner's name or the contact's WhatsApp name), its property (the message's, else its lease's,
--     statement's or arrangement's), its South African date and its approval: the pending request, else the latest
--     decided one, and whether the AI agent approved it (its own reply to a contact; never a tenant message).
--
-- A monitoring report, never a transaction: nothing here writes, sends or approves.

-- --------------------------------------------------------------------------- statement uploads

create function public.reports_statement_uploads(p_company_id uuid)
returns table (
  statement_id uuid,
  file_name text,
  statement_number text,
  property_id uuid,
  property_name text,
  tenant_id uuid,
  tenant_name text,
  unit_id uuid,
  unit_number text,
  source_system public.statement_source,
  status public.statement_status,
  uploaded_at timestamptz,
  uploaded_on date,
  statement_date date,
  processing_error text,
  duplicate_of_statement_id uuid,
  extraction_confidence numeric
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
    s.id,
    s.file_name,
    s.statement_number,
    p.id,
    p.name,
    t.id,
    t.trading_name,
    un.id,
    un.unit_number,
    s.source_system,
    s.status,
    s.uploaded_at,
    (s.uploaded_at at time zone 'Africa/Johannesburg')::date,
    s.statement_date,
    s.processing_error,
    s.duplicate_of_statement_id,
    x.overall_confidence::numeric
  from public.statements s
  join public.properties p on p.company_id = s.company_id and p.id = s.property_id
  left join public.tenants t on t.company_id = s.company_id and t.id = s.tenant_id
  left join public.units un on un.company_id = s.company_id and un.id = s.unit_id
  left join public.statement_extractions x on x.company_id = s.company_id and x.statement_id = s.id
  where s.company_id = p_company_id
  order by s.uploaded_at desc, s.id;
end;
$$;
revoke all on function public.reports_statement_uploads(uuid) from public, anon;
grant execute on function public.reports_statement_uploads(uuid) to authenticated;
comment on function public.reports_statement_uploads(uuid) is
  'Reports service (R-06): every statement of the company with its property, tenant and unit names, source system, '
  'status, upload time and South African upload date, processing error, duplicate link and extraction confidence. Members only.';

-- --------------------------------------------------------------------------- fields waiting for review

create function public.reports_statement_review_fields(p_company_id uuid)
returns table (
  statement_id uuid,
  name public.extraction_field_name,
  value jsonb,
  flagged boolean,
  corrected_value jsonb,
  confirmed_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select s.id, f.name, f.value, f.flagged, f.corrected_value, f.confirmed_at
  from public.statements s
  join public.statement_extractions x on x.company_id = s.company_id and x.statement_id = s.id
  join public.statement_extraction_fields f on f.company_id = x.company_id and f.extraction_id = x.id
  where s.company_id = p_company_id
    and s.status = 'review_required'
  order by s.id, f.name;
end;
$$;
revoke all on function public.reports_statement_review_fields(uuid) from public, anon;
grant execute on function public.reports_statement_review_fields(uuid) to authenticated;
comment on function public.reports_statement_review_fields(uuid) is
  'Reports service (R-06): the extracted fields of the statements waiting for review, with value, flag, correction and '
  'confirmation, so the domain counts the fields a reviewer still has to resolve. Members only.';

-- --------------------------------------------------------------------------- communication activity

create function public.reports_communication_activity(p_company_id uuid)
returns table (
  communication_id uuid,
  created_at timestamptz,
  created_on date,
  channel public.channel,
  direction public.message_direction,
  message_type public.message_type,
  recipient_type public.recipient_type,
  counterparty_name text,
  tenant_id uuid,
  property_id uuid,
  property_name text,
  statement_id uuid,
  arrangement_id uuid,
  status public.delivery_status,
  failure_reason text,
  approval_decision public.approval_decision,
  approval_requested_at timestamptz,
  approval_decided_at timestamptz,
  approval_decided_by_agent boolean
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
    c.id,
    c.created_at,
    (c.created_at at time zone 'Africa/Johannesburg')::date,
    c.channel,
    c.direction,
    c.message_type,
    c.recipient_type,
    case c.recipient_type
      when 'tenant' then t.trading_name
      when 'property_owner' then pr.full_name
      when 'contact' then k.profile_name
    end,
    c.tenant_id,
    p.id,
    p.name,
    c.statement_id,
    c.arrangement_id,
    c.status,
    c.failure_reason,
    a.decision,
    a.requested_at,
    a.decided_at,
    case when a.id is null then null else a.decided_by_agent_run_id is not null end
  from public.communications c
  left join public.tenants t on t.company_id = c.company_id and t.id = c.tenant_id
  left join public.profiles pr on pr.id = c.owner_user_id
  left join public.whatsapp_contacts k on k.company_id = c.company_id and k.id = c.contact_id
  left join public.leases le on le.company_id = c.company_id and le.id = c.lease_id
  left join public.statements st on st.company_id = c.company_id and st.id = c.statement_id
  left join public.payment_arrangements pa on pa.company_id = c.company_id and pa.id = c.arrangement_id
  left join public.properties p
    on p.company_id = c.company_id and p.id = coalesce(c.property_id, le.property_id, st.property_id, pa.property_id)
  left join lateral (
    select ma.id, ma.decision, ma.requested_at, ma.decided_at, ma.decided_by_agent_run_id
    from public.message_approvals ma
    where ma.company_id = c.company_id and ma.communication_id = c.id
    order by (ma.decision = 'pending') desc, ma.requested_at desc, ma.id
    limit 1
  ) a on true
  where c.company_id = p_company_id
  order by c.created_at desc, c.id;
end;
$$;
revoke all on function public.reports_communication_activity(uuid) from public, anon;
grant execute on function public.reports_communication_activity(uuid) to authenticated;
comment on function public.reports_communication_activity(uuid) is
  'Reports service (R-06): every message of the company with its counterparty name, property (its own, else its lease''s, '
  'statement''s or arrangement''s), South African date, delivery status and its approval (pending, else latest decided). Members only.';
