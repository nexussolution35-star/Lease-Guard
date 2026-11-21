-- Statement review and correction (PRD module 6, ticket S-04): a writer works through a processed statement.
--
-- * statement_extraction_fields gains confirmed_by_user_id / confirmed_at (a person confirmed the extracted value
--   is right) and corrected_at (when the value was corrected). Confirming and correcting are exclusive: a correction
--   replaces a confirmation and confirming the extracted value drops the correction. A field without a value
--   cannot be confirmed: it stays unresolved until someone enters it. The reviewer and times are stamped from
--   auth.uid() and now(), so they cannot be forged.
-- * guards (every role): fields are confirmed or corrected only while the extraction is pending review and the
--   statement needs review; a statement's tenant, unit and lease cannot change once it is verified, rejected or a
--   duplicate. Whether they belong together is the existing composite foreign keys' job
--   (20261109101200_lease_party_consistency.sql, statements_unit_fk).
-- * privileges: a signed-in caller updates only a field's corrected_value and confirmed_at, an extraction's
--   status and review_notes, and a statement's review columns (match, status, dates, number, figures, duplicate
--   link, processing error). The file, property, uploader and verifier stay fixed. Extractions, their fields and
--   line items are written by the statement-processing worker (service role) only; no signed-in caller inserts
--   or deletes them, nor deletes a statement. INSERT on statements is S-03's (20261121093317_statement_uploads.sql).
-- * audit: every correction and confirmation is recorded with before and after (one audit row per change), and a
--   change of a statement's tenant, unit or lease is recorded with the statement's other changes.

-- --------------------------------------------------------------------------- columns

alter table public.statement_extraction_fields
  add column confirmed_by_user_id uuid,
  add column confirmed_at timestamptz,
  add column corrected_at timestamptz;

-- Corrections made before this migration: when they were made is the row's last change.
update public.statement_extraction_fields set corrected_at = updated_at where corrected_value is not null;

alter table public.statement_extraction_fields
  add constraint statement_extraction_fields_confirmed_by_fk foreign key (company_id, confirmed_by_user_id)
    references public.company_users (company_id, user_id),
  add constraint statement_extraction_fields_confirmation_check check ((confirmed_at is null) = (confirmed_by_user_id is null)),
  add constraint statement_extraction_fields_corrected_at_check check ((corrected_value is null) = (corrected_at is null)),
  -- Nothing is guessed: a value the extractor did not find is entered (corrected), never confirmed.
  add constraint statement_extraction_fields_confirm_value_check check (confirmed_at is null or value <> 'null'::jsonb),
  add constraint statement_extraction_fields_confirm_or_correct_check check (confirmed_at is null or corrected_value is null);

create index statement_extraction_fields_confirmed_by_idx on public.statement_extraction_fields (company_id, confirmed_by_user_id)
  where confirmed_by_user_id is not null;

comment on column public.statement_extraction_fields.confirmed_at is
  'When a reviewer confirmed the extracted value as correct; null when unconfirmed or corrected instead.';
comment on column public.statement_extraction_fields.corrected_at is
  'When the reviewer entered corrected_value; null when not corrected.';

-- --------------------------------------------------------------------------- privileges

revoke update, delete on public.statements from authenticated;
grant update (
  tenant_id, unit_id, lease_id, status, processing_error, statement_number, statement_date, period_start, period_end,
  opening_balance, rental_charged, additional_charges, payments_received, closing_balance, total_due,
  duplicate_of_statement_id
) on public.statements to authenticated;

revoke insert, update, delete on public.statement_extractions from authenticated;
grant update (status, review_notes) on public.statement_extractions to authenticated;

revoke insert, update, delete on public.statement_extraction_fields from authenticated;
grant update (corrected_value, confirmed_at) on public.statement_extraction_fields to authenticated;

revoke insert, update, delete on public.statement_line_items from authenticated;

-- --------------------------------------------------------------------------- fields: guard and stamp

-- Every role: these are product rules. SECURITY INVOKER: the caller can read its own extraction and statement.
create function private.guard_extraction_field_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_extraction_status public.extraction_status;
  v_statement_status public.statement_status;
begin
  if new.corrected_value is not distinct from old.corrected_value and new.confirmed_at is not distinct from old.confirmed_at then
    return new;
  end if;
  select e.status, s.status into v_extraction_status, v_statement_status
  from public.statement_extractions e
  join public.statements s on s.company_id = e.company_id and s.id = e.statement_id
  where e.company_id = new.company_id and e.id = new.extraction_id;
  if v_extraction_status is distinct from 'pending_review' or v_statement_status is distinct from 'review_required' then
    raise exception 'This statement is no longer under review, so its extracted values cannot change.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_extraction_field_review() from public, anon, authenticated;

create trigger guard_review before update on public.statement_extraction_fields
  for each row execute function private.guard_extraction_field_review();

-- Stamps who corrected or confirmed a field and when. A correction clears a confirmation; confirming an already
-- confirmed field keeps the first confirmation. The service role keeps the values it writes (fixtures, imports).
create function private.stamp_extraction_field_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.corrected_value is distinct from old.corrected_value then
    if new.corrected_value is null then
      new.corrected_by_user_id := null;
      new.corrected_at := null;
    else
      if (select auth.uid()) is not null then
        new.corrected_by_user_id := (select auth.uid());
        new.corrected_at := now();
      else
        new.corrected_at := coalesce(new.corrected_at, now());
      end if;
      new.confirmed_by_user_id := null;
      new.confirmed_at := null;
    end if;
  end if;
  if new.confirmed_at is distinct from old.confirmed_at then
    if new.confirmed_at is null then
      new.confirmed_by_user_id := null;
    elsif old.confirmed_at is not null then
      new.confirmed_at := old.confirmed_at;
      new.confirmed_by_user_id := old.confirmed_by_user_id;
    elsif (select auth.uid()) is not null then
      new.confirmed_by_user_id := (select auth.uid());
      new.confirmed_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_extraction_field_review() from public, anon, authenticated;

-- Replaces stamp_correction (20261107100900_audit_triggers.sql), which stamped corrections only.
drop trigger stamp_correction on public.statement_extraction_fields;
drop function private.stamp_field_correction();
create trigger stamp_review before update on public.statement_extraction_fields
  for each row execute function private.stamp_extraction_field_review();

-- --------------------------------------------------------------------------- fields: audit

-- One audit row per correction or confirmation, on the extraction, with the field's effective value before and
-- after (the correction when there is one, else the extracted value) and whether it was confirmed.
create function private.audit_extraction_field_review()
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
      when v_confirmed then format('Confirmed extracted field %s', new.name)
      else format('Cleared the correction of extracted field %s', new.name)
    end,
    v_changes
  );
  return null;
end;
$$;
revoke all on function private.audit_extraction_field_review() from public, anon, authenticated;

-- Replaces audit_correction (20261107100900_audit_triggers.sql), which recorded corrections only.
drop trigger audit_correction on public.statement_extraction_fields;
drop function private.audit_field_correction();
create trigger audit_review after update on public.statement_extraction_fields
  for each row when (old.corrected_value is distinct from new.corrected_value or old.confirmed_at is distinct from new.confirmed_at)
  execute function private.audit_extraction_field_review();

-- --------------------------------------------------------------------------- statements: match guard

-- Every role: a statement that is verified, rejected or a duplicate is a closed record; its tenant, unit and lease
-- stay as they were reviewed.
create function private.guard_statement_match()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.tenant_id is distinct from old.tenant_id or new.unit_id is distinct from old.unit_id or new.lease_id is distinct from old.lease_id)
     and old.status in ('verified', 'rejected', 'duplicate') then
    raise exception 'This statement is %, so its tenant, unit and lease cannot change.', old.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_statement_match() from public, anon, authenticated;

create trigger guard_match before update on public.statements
  for each row execute function private.guard_statement_match();

-- --------------------------------------------------------------------------- statements: audit

-- As 20261121074800_statement_extracted_facts.sql, plus the tenant, unit and lease.
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
  if jsonb_array_length(changes) = 0 then
    return null;
  end if;
  perform private.write_audit(
    new.company_id,
    case
      when new.status is distinct from old.status and new.status = 'verified' then 'verify'
      when new.status is distinct from old.status and new.status = 'rejected' then 'reject'
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
