-- Statement verification, rejection and marking as a duplicate (PRD module 6, ticket S-05).
--
-- * statements.rejection_reason: why a writer rejected a statement (only on a rejected statement).
-- * privileges: figures reach a statement only through verification. A signed-in caller no longer updates the
--   figures, the statement number, date and period, or the duplicate link directly (S-04 granted them); it keeps
--   the match (tenant, unit, lease), the status and the processing error, which processing retries write. The
--   three review outcomes are SECURITY DEFINER functions that check the caller is a writer of the company:
--     public.verify_statement           every field resolved, tenant, unit and lease set; writes the reviewed values
--                                       (number, date, period, six figures) onto the statement, stamps the verifier,
--                                       closes the extraction review and resolves the statement's review event;
--     public.reject_statement           with a reason; closes the extraction (rejected) and the review event;
--     public.mark_statement_duplicate   names the other (live) statement of the company; closes as reject does.
-- * guard (signed-in callers): a direct status change into or out of verified, rejected or duplicate is refused, so
--   those transitions happen only through the functions above. The service role (workers, fixtures) is unaffected.
-- * audit: private.audit_statement_change also records the rejection reason and the duplicate link; the extraction
--   and the review event keep their own audit triggers.

-- --------------------------------------------------------------------------- columns

alter table public.statements
  add column rejection_reason text,
  add constraint statements_rejection_reason_check check (
    rejection_reason is null or (status = 'rejected' and length(btrim(rejection_reason)) between 1 and 1000)
  );

comment on column public.statements.rejection_reason is
  'Why a writer rejected the statement (public.reject_statement); null unless rejected.';

-- --------------------------------------------------------------------------- privileges

revoke update on public.statements from authenticated;
grant update (tenant_id, unit_id, lease_id, status, processing_error) on public.statements to authenticated;

-- --------------------------------------------------------------------------- guard

create function private.guard_statement_outcome()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- current_user is the function owner inside the SECURITY DEFINER review functions, so only direct writes match.
  if current_user in ('authenticated', 'anon')
     and new.status is distinct from old.status
     and (new.status in ('verified', 'rejected', 'duplicate') or old.status in ('verified', 'rejected', 'duplicate')) then
    raise exception 'A statement is verified, rejected or marked as a duplicate only through its review.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_statement_outcome() from public, anon, authenticated;

create trigger guard_outcome before update of status on public.statements
  for each row execute function private.guard_statement_outcome();

-- --------------------------------------------------------------------------- shared checks

-- The statement under review, locked, for a writer of the company. 42501 for a caller who cannot write the company;
-- null when the statement is not in the company; P0001 when it is not under review.
create function private.statement_for_outcome(p_company_id uuid, p_statement_id uuid, p_action text)
returns public.statements
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statements;
begin
  if (select auth.uid()) is null
     or not (p_company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'Only a company admin or property manager can % a statement.', p_action using errcode = '42501';
  end if;
  select * into s from public.statements where company_id = p_company_id and id = p_statement_id for update;
  if not found then
    return null;
  end if;
  if s.status <> 'review_required' then
    raise exception 'This statement is %, so it cannot be %.', replace(s.status::text, '_', ' '),
      case p_action when 'verify' then 'verified' when 'reject' then 'rejected' else 'marked as a duplicate' end
      using errcode = 'P0001';
  end if;
  return s;
end;
$$;
revoke all on function private.statement_for_outcome(uuid, uuid, text) from public, anon, authenticated;

-- Resolves the open statement_review_required event of a statement (the review is over).
create function private.resolve_statement_review_event(p_company_id uuid, p_statement_id uuid, p_notes text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.monitoring_events
  set status = 'resolved', resolution_notes = p_notes
  where company_id = p_company_id and statement_id = p_statement_id and type = 'statement_review_required'
    and status not in ('resolved', 'dismissed');
$$;
revoke all on function private.resolve_statement_review_event(uuid, uuid, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------- verify

-- Verifies a statement under review: every extracted field is resolved (corrected, confirmed, or found without a
-- flag) and its tenant, unit and lease are set. Writes the reviewed values (the correction, else the extracted value)
-- onto the statement as its monitoring record. Unresolved fields or a missing match are refused with 23514 and every
-- reason in the message. Returns the statement id, or null when it is not in the company.
create function public.verify_statement(p_company_id uuid, p_statement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statements;
  v_extraction_id uuid;
  v_extraction_status public.extraction_status;
  v_problems text[] := '{}';
  v_values jsonb;
  v_corrected boolean;
begin
  s := private.statement_for_outcome(p_company_id, p_statement_id, 'verify');
  if s.id is null then
    return null;
  end if;

  select e.id, e.status into v_extraction_id, v_extraction_status
  from public.statement_extractions e
  where e.company_id = p_company_id and e.statement_id = s.id
  for update;
  if v_extraction_id is null then
    raise exception 'This statement has no extracted values to verify: process it again.' using errcode = '23514';
  end if;
  if v_extraction_status <> 'pending_review' then
    raise exception 'This statement''s extraction is already %.', v_extraction_status using errcode = 'P0001';
  end if;

  if s.tenant_id is null then v_problems := v_problems || 'The tenant is not set'::text; end if;
  if s.unit_id is null then v_problems := v_problems || 'The unit is not set'::text; end if;
  if s.lease_id is null then v_problems := v_problems || 'The lease is not set'::text; end if;
  -- Mirrors fieldResolution (@leaseguard/domain rules/statementReview.ts); every field name must be present.
  v_problems := v_problems || coalesce((
    select array_agg(format('%s is not confirmed or corrected', n.name) order by n.ord)
    from unnest(enum_range(null::public.extraction_field_name)) with ordinality as n(name, ord)
    left join public.statement_extraction_fields f
      on f.company_id = p_company_id and f.extraction_id = v_extraction_id and f.name = n.name
    where f.id is null
       or not (f.corrected_value is not null or (f.value <> 'null'::jsonb and (f.confirmed_at is not null or not f.flagged)))
  ), '{}');
  if cardinality(v_problems) > 0 then
    raise exception '%', array_to_string(v_problems, '; ') using errcode = '23514';
  end if;

  select jsonb_object_agg(f.name::text, coalesce(f.corrected_value, f.value)), bool_or(f.corrected_value is not null)
  into v_values, v_corrected
  from public.statement_extraction_fields f
  where f.company_id = p_company_id and f.extraction_id = v_extraction_id;

  update public.statements set
    status = 'verified',
    statement_number = v_values ->> 'statement_number',
    statement_date = (v_values ->> 'statement_date')::date,
    period_start = (v_values ->> 'period_start')::date,
    period_end = (v_values ->> 'period_end')::date,
    opening_balance = (v_values ->> 'opening_balance')::numeric,
    rental_charged = (v_values ->> 'rental_charged')::numeric,
    additional_charges = (v_values ->> 'additional_charges')::numeric,
    payments_received = (v_values ->> 'payments_received')::numeric,
    -- The statement's outstanding balance is its closing balance.
    closing_balance = (v_values ->> 'outstanding_balance')::numeric,
    total_due = (v_values ->> 'total_due')::numeric,
    processing_error = null,
    verified_by_user_id = (select auth.uid()),
    verified_at = now()
  where company_id = p_company_id and id = s.id;

  update public.statement_extractions
  set status = case when v_corrected then 'corrected'::public.extraction_status else 'confirmed'::public.extraction_status end
  where company_id = p_company_id and id = v_extraction_id;

  perform private.resolve_statement_review_event(p_company_id, s.id, 'Statement verified');
  return s.id;
end;
$$;
comment on function public.verify_statement(uuid, uuid) is
  'Verifies a statement under review from its reviewed extraction (writers); the only way figures reach a statement.';
revoke execute on function public.verify_statement(uuid, uuid) from public, anon;
grant execute on function public.verify_statement(uuid, uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------- reject

-- Rejects a statement under review with a reason (1–1000 characters). Returns the statement id, or null when it is
-- not in the company.
create function public.reject_statement(p_company_id uuid, p_statement_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statements;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Give a reason for rejecting the statement (at most 1000 characters).' using errcode = '23514';
  end if;
  s := private.statement_for_outcome(p_company_id, p_statement_id, 'reject');
  if s.id is null then
    return null;
  end if;

  update public.statements set status = 'rejected', rejection_reason = v_reason
  where company_id = p_company_id and id = s.id;
  update public.statement_extractions set status = 'rejected', review_notes = v_reason
  where company_id = p_company_id and statement_id = s.id and status = 'pending_review';
  perform private.resolve_statement_review_event(p_company_id, s.id, format('Statement rejected: %s', v_reason));
  return s.id;
end;
$$;
comment on function public.reject_statement(uuid, uuid, text) is 'Rejects a statement under review with a reason (writers).';
revoke execute on function public.reject_statement(uuid, uuid, text) from public, anon;
grant execute on function public.reject_statement(uuid, uuid, text) to authenticated, service_role;

-- --------------------------------------------------------------------------- mark as duplicate

-- Marks a statement under review as a duplicate of another statement of the company that is not itself rejected or a
-- duplicate. Returns the statement id, or null when it is not in the company.
create function public.mark_statement_duplicate(p_company_id uuid, p_statement_id uuid, p_duplicate_of_statement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statements;
  v_original public.statements;
begin
  s := private.statement_for_outcome(p_company_id, p_statement_id, 'duplicate');
  if s.id is null then
    return null;
  end if;
  if p_duplicate_of_statement_id = s.id then
    raise exception 'A statement cannot be a duplicate of itself.' using errcode = '23514';
  end if;
  select * into v_original from public.statements where company_id = p_company_id and id = p_duplicate_of_statement_id;
  if not found then
    raise exception 'The other statement is not in this workspace.' using errcode = '23514';
  end if;
  if v_original.status in ('rejected', 'duplicate') then
    raise exception 'The other statement is %: mark this one as a duplicate of the statement on record instead.',
      v_original.status using errcode = '23514';
  end if;

  update public.statements set status = 'duplicate', duplicate_of_statement_id = v_original.id
  where company_id = p_company_id and id = s.id;
  update public.statement_extractions set status = 'rejected', review_notes = format('Duplicate of %s', v_original.file_name)
  where company_id = p_company_id and statement_id = s.id and status = 'pending_review';
  perform private.resolve_statement_review_event(p_company_id, s.id, format('Statement is a duplicate of %s', v_original.file_name));
  return s.id;
end;
$$;
comment on function public.mark_statement_duplicate(uuid, uuid, uuid) is
  'Marks a statement under review as a duplicate of another live statement of the company (writers).';
revoke execute on function public.mark_statement_duplicate(uuid, uuid, uuid) from public, anon;
grant execute on function public.mark_statement_duplicate(uuid, uuid, uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------- audit

-- As 20261121110412_statement_review.sql, plus the rejection reason and the duplicate link.
create or replace function private.audit_statement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changes jsonb := '[]'::jsonb;
  v_match_changed boolean := old.tenant_id is distinct from new.tenant_id or old.unit_id is distinct from new.unit_id
    or old.lease_id is distinct from new.lease_id;
begin
  if old.status is distinct from new.status then
    changes := changes || private.field_change('status', old.status, new.status);
  end if;
  if old.tenant_id is distinct from new.tenant_id then
    changes := changes || private.field_change('tenantId', old.tenant_id, new.tenant_id);
  end if;
  if old.unit_id is distinct from new.unit_id then
    changes := changes || private.field_change('unitId', old.unit_id, new.unit_id);
  end if;
  if old.lease_id is distinct from new.lease_id then
    changes := changes || private.field_change('leaseId', old.lease_id, new.lease_id);
  end if;
  if old.statement_number is distinct from new.statement_number then
    changes := changes || private.field_change('statementNumber', old.statement_number, new.statement_number);
  end if;
  if old.statement_date is distinct from new.statement_date then
    changes := changes || private.field_change('statementDate', old.statement_date, new.statement_date);
  end if;
  if old.period_start is distinct from new.period_start then
    changes := changes || private.field_change('periodStart', old.period_start, new.period_start);
  end if;
  if old.period_end is distinct from new.period_end then
    changes := changes || private.field_change('periodEnd', old.period_end, new.period_end);
  end if;
  if old.opening_balance is distinct from new.opening_balance then
    changes := changes || private.field_change('openingBalance', old.opening_balance, new.opening_balance);
  end if;
  if old.rental_charged is distinct from new.rental_charged then
    changes := changes || private.field_change('rentalCharged', old.rental_charged, new.rental_charged);
  end if;
  if old.additional_charges is distinct from new.additional_charges then
    changes := changes || private.field_change('additionalCharges', old.additional_charges, new.additional_charges);
  end if;
  if old.payments_received is distinct from new.payments_received then
    changes := changes || private.field_change('paymentsReceived', old.payments_received, new.payments_received);
  end if;
  if old.closing_balance is distinct from new.closing_balance then
    changes := changes || private.field_change('closingBalance', old.closing_balance, new.closing_balance);
  end if;
  if old.total_due is distinct from new.total_due then
    changes := changes || private.field_change('totalDue', old.total_due, new.total_due);
  end if;
  if old.rejection_reason is distinct from new.rejection_reason then
    changes := changes || private.field_change('rejectionReason', old.rejection_reason, new.rejection_reason);
  end if;
  if old.duplicate_of_statement_id is distinct from new.duplicate_of_statement_id then
    changes := changes || private.field_change('duplicateOfStatementId', old.duplicate_of_statement_id, new.duplicate_of_statement_id);
  end if;
  if jsonb_array_length(changes) = 0 then
    return null;
  end if;
  perform private.write_audit(
    new.company_id,
    case
      when new.status is distinct from old.status and new.status = 'verified' then 'verify'
      when new.status is distinct from old.status and new.status in ('rejected', 'duplicate') then 'reject'
      else 'update'
    end,
    'statement',
    new.id,
    format('Statement %s: %s', new.file_name,
      case when old.status is distinct from new.status then format('status %s → %s', old.status, new.status)
           when v_match_changed then 'tenant, unit and lease set'
           else 'details corrected' end),
    changes
  );
  return null;
end;
$$;
