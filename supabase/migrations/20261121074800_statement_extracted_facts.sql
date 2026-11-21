-- Statement facts come from the document (ticket S-01).
--
-- * extraction_field_name gains `statement_number` and `opening_balance`: the extractor now reports
--   both as fields with a confidence and a flag, like every other value, instead of dropping the
--   opening balance and never reading the number. Enum order is the domain EXTRACTION_FIELD_NAMES
--   order (enum-parity.test.ts).
-- * statements.statement_date, period_start and period_end become nullable: the uploader no longer
--   has to type them; they are read from the document and confirmed at review. A verified statement
--   still carries all three (statements_verified_dates_check), and a period is known as a whole or not
--   at all. Existing rows all have them, so nothing changes for them.
-- * private.audit_statement_change also records changes to the statement number, date and period,
--   which verification writes from the reviewed extraction.
--
-- ALTER TYPE ... ADD VALUE runs inside the migration transaction; the new values are not used in
-- this file, so that is allowed.

alter type public.extraction_field_name add value if not exists 'statement_number' before 'statement_date';
alter type public.extraction_field_name add value if not exists 'opening_balance' before 'rental_charged';

alter table public.statements
  alter column statement_date drop not null,
  alter column period_start drop not null,
  alter column period_end drop not null,
  add constraint statements_period_known_check check ((period_start is null) = (period_end is null)),
  add constraint statements_verified_dates_check check (
    status <> 'verified' or (statement_date is not null and period_start is not null and period_end is not null)
  );

comment on column public.statements.statement_date is
  'Statement date as typed at upload or confirmed from the document; required once verified.';
comment on column public.statements.period_start is
  'Start of the statement period; null until known (typed or confirmed from the document), required once verified.';
comment on column public.statements.period_end is
  'End of the statement period; known together with period_start, required once verified.';

create or replace function private.audit_statement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changes jsonb := '[]'::jsonb;
begin
  if old.status is distinct from new.status then
    changes := changes || private.field_change('status', old.status, new.status);
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
           else 'details corrected' end),
    changes
  );
  return null;
end;
$$;
