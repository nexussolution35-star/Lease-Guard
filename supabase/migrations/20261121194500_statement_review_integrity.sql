-- Statement review integrity (PRD module 6, acceptance findings).
--
-- * The statement number is optional. Many statements print none, and a value that is not on the document cannot be
--   confirmed (20261121110412_statement_review.sql), so a reviewer would have had to invent one to verify. A reviewer
--   now confirms explicitly that the statement number is not on the statement: the field keeps its missing value
--   (JSON null) and gains a confirmation, stamped and audited like any other ("Confirmed that the statement number is
--   not on the statement"). Nothing is filled in; the verified statement's number stays null. Every other field still
--   needs a value. Mirrors OPTIONAL_EXTRACTION_FIELDS (@leaseguard/domain rules/statementReview.ts).
-- * statement_extractions: a signed-in caller no longer updates status or review_notes directly; an extraction's
--   review is closed only by public.verify_statement, public.reject_statement and public.mark_statement_duplicate.
-- * statements: a signed-in caller no longer updates status or processing_error directly (only tenant, unit and
--   lease, which the review sets). Status and processing error are written by the statement-processing worker
--   (service role) and by public.retry_statement_processing, which puts a statement whose processing failed back to
--   `uploaded` for a writer of the company (the API's retry path).
-- * public.verify_statement also refuses a period that ends before it starts and a lease that was not in force on the
--   reviewed statement date (a draft lease never was), with every reason in one 23514 message as before. A writer can
--   still set the lease directly, so the database checks it rather than trusting the API.

-- --------------------------------------------------------------------------- statement number: may be absent

alter table public.statement_extraction_fields
  drop constraint statement_extraction_fields_confirm_value_check,
  -- Nothing is guessed: a value the extractor did not find is entered (corrected), never confirmed, except the
  -- statement number, whose confirmation without a value records that the statement does not print one.
  add constraint statement_extraction_fields_confirm_value_check
    check (confirmed_at is null or value <> 'null'::jsonb or name = 'statement_number');

comment on column public.statement_extraction_fields.confirmed_at is
  'When a reviewer confirmed the extracted value as correct; for a statement_number without a value, that the statement '
  'prints no number. Null when unconfirmed or corrected instead.';

-- As 20261121110412_statement_review.sql, with its own summary for confirming that the number is not on the statement.
create or replace function private.audit_extraction_field_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_corrected boolean := new.corrected_value is distinct from old.corrected_value;
  v_confirmed boolean := new.confirmed_at is distinct from old.confirmed_at and new.confirmed_at is not null;
  v_changes jsonb := jsonb_build_array(jsonb_build_object(
    'field', new.name::text,
    'before', coalesce(old.corrected_value, old.value),
    'after', coalesce(new.corrected_value, new.value)
  ));
begin
  if new.confirmed_at is distinct from old.confirmed_at then
    v_changes := v_changes || private.field_change(new.name::text || '.confirmed', old.confirmed_at is not null, new.confirmed_at is not null);
  end if;
  perform private.write_audit(
    new.company_id,
    case when v_confirmed and not (v_corrected and new.corrected_value is not null) then 'verify' else 'update' end,
    'statement_extraction',
    new.extraction_id,
    case
      when v_corrected and new.corrected_value is not null then format('Corrected extracted field %s', new.name)
      when v_confirmed and new.value = 'null'::jsonb then format('Confirmed that %s is not on the statement', new.name)
      when v_confirmed then format('Confirmed extracted field %s', new.name)
      else format('Cleared the correction of extracted field %s', new.name)
    end,
    v_changes
  );
  return null;
end;
$$;

-- --------------------------------------------------------------------------- privileges

-- Extraction status and review notes change only through the review outcome functions (SECURITY DEFINER).
revoke update on public.statement_extractions from authenticated;

-- Status and processing error: the worker (service role) and public.retry_statement_processing only.
revoke update on public.statements from authenticated;
grant update (tenant_id, unit_id, lease_id) on public.statements to authenticated;

-- --------------------------------------------------------------------------- retry

-- Puts a statement whose automatic processing failed (review_required with a processing error) back to `uploaded`
-- with the error cleared, so it can be queued again. 42501 for a caller who cannot write the company; null when the
-- statement is not in the company; P0001 when its processing has not failed. The audit trigger records the change.
create function public.retry_statement_processing(p_company_id uuid, p_statement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.statements;
begin
  if (select auth.uid()) is null
     or not (p_company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'Only a company admin or property manager can process a statement again.' using errcode = '42501';
  end if;
  select * into s from public.statements where company_id = p_company_id and id = p_statement_id for update;
  if not found then
    return null;
  end if;
  if s.status <> 'review_required' or s.processing_error is null then
    raise exception 'This statement''s processing has not failed, so it is not processed again from the start.' using errcode = 'P0001';
  end if;
  update public.statements set status = 'uploaded', processing_error = null
  where company_id = p_company_id and id = s.id;
  return s.id;
end;
$$;
comment on function public.retry_statement_processing(uuid, uuid) is
  'Puts a statement whose processing failed back to uploaded so it is processed again (writers).';
revoke execute on function public.retry_statement_processing(uuid, uuid) from public, anon;
grant execute on function public.retry_statement_processing(uuid, uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------- verify

-- As 20261121141736_statement_verification.sql, plus: the statement number may be confirmed as not on the statement;
-- the reviewed period must not end before it starts; the lease must have been in force on the reviewed statement
-- date. Every reason is listed in one 23514 message.
create or replace function public.verify_statement(p_company_id uuid, p_statement_id uuid)
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
  v_reviewed jsonb;
  v_corrected boolean;
  v_statement_date date;
  v_period_start date;
  v_period_end date;
  v_lease public.leases;
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
       or not (
         f.corrected_value is not null
         or (f.value <> 'null'::jsonb and (f.confirmed_at is not null or not f.flagged))
         -- Confirmed as not on the statement (the statement number only, by statement_extraction_fields_confirm_value_check).
         or (f.value = 'null'::jsonb and f.confirmed_at is not null)
       )
  ), '{}');

  -- The reviewed values (the correction, else the extracted value); JSON null for a number not on the statement.
  -- v_reviewed holds only the resolved ones: an unconfirmed date is never checked against the lease or the period.
  select jsonb_object_agg(f.name::text, coalesce(f.corrected_value, f.value)),
         jsonb_object_agg(f.name::text, coalesce(f.corrected_value, f.value))
           filter (where f.corrected_value is not null or (f.value <> 'null'::jsonb and (f.confirmed_at is not null or not f.flagged))),
         bool_or(f.corrected_value is not null)
  into v_values, v_reviewed, v_corrected
  from public.statement_extraction_fields f
  where f.company_id = p_company_id and f.extraction_id = v_extraction_id;

  -- Dates are checked once reviewed and readable; an unreadable one is refused when the statement is written.
  if pg_input_is_valid(v_reviewed ->> 'statement_date', 'date') then v_statement_date := (v_reviewed ->> 'statement_date')::date; end if;
  if pg_input_is_valid(v_reviewed ->> 'period_start', 'date') then v_period_start := (v_reviewed ->> 'period_start')::date; end if;
  if pg_input_is_valid(v_reviewed ->> 'period_end', 'date') then v_period_end := (v_reviewed ->> 'period_end')::date; end if;
  if v_period_start is not null and v_period_end is not null and v_period_end < v_period_start then
    v_problems := v_problems || 'The period end is before the period start'::text;
  end if;
  -- Mirrors leaseInForceOn: commenced on or before the statement date, not yet expired, never a draft.
  if s.lease_id is not null and v_statement_date is not null then
    select * into v_lease from public.leases where company_id = p_company_id and id = s.lease_id;
    if v_lease.id is not null
       and (v_lease.status = 'draft' or v_statement_date not between v_lease.commencement_date and v_lease.expiry_date) then
      v_problems := v_problems || format('The lease %s was not in force on %s', v_lease.reference, to_char(v_statement_date, 'DD Mon YYYY'));
    end if;
  end if;

  if cardinality(v_problems) > 0 then
    raise exception '%', array_to_string(v_problems, '; ') using errcode = '23514';
  end if;

  update public.statements set
    status = 'verified',
    statement_number = v_values ->> 'statement_number',
    statement_date = v_statement_date,
    period_start = v_period_start,
    period_end = v_period_end,
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
