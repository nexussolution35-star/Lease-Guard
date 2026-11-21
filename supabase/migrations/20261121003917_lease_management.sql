-- Lease management (PRD module 5, ticket M5-01): create and edit leases and their bank guarantee, all audited.
--
-- Writers (company_admin, property_manager) already held table-wide INSERT, UPDATE and DELETE on leases and
-- lease_bank_guarantees through RLS. This migration narrows that to what the product allows:
--   * no hard delete of a lease: statements, arrangements, events and messages reference it;
--   * column grants: the company and the timestamps are fixed; verification is never inserted (a new
--     lease is unverified), and the verifier and time are stamped by the database;
--   * guards: the tenant, property and unit belong to the lease's company and the unit to the property;
--     no lease is added to (or moved onto) an archived property; the parties cannot change once
--     statements, arrangements, monitoring events or messages name the lease, or the unit holds it as
--     its current lease;
--   * a change to a lease term (parties, dates, rentals, due day, escalation, renewal option, deposit),
--     whoever writes it, or a signed-in user's change to its bank guarantee returns a verified lease to
--     pending verification, so unverified terms never drive monitoring (PRD: lease terms are verified before they are used);
--   * audit: create and update of a lease, and every change to its bank guarantee, are recorded with the
--     signed-in user as actor; a reset of verification says so;
--   * public.save_lease writes a lease and its guarantee in one transaction under the caller's RLS.

-- --------------------------------------------------------------------------- privileges

revoke insert, update, delete on public.leases from authenticated;
grant insert (
  company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
  initial_monthly_rental, current_monthly_rental, payment_due_day,
  escalation_type, escalation_percentage, escalation_fixed_amount, escalation_cpi_assumed_percentage,
  escalation_cpi_margin_percentage, escalation_frequency, first_escalation_date,
  renewal_option_exists, renewal_term_months, renewal_notice_period_months, renewal_notes,
  deposit_amount, deposit_basis_months, deposit_held_by, deposit_received_on, deposit_interest_bearing, deposit_notes,
  status, previous_lease_id, notes
) on public.leases to authenticated;
-- `verified` and `status` stay writable for lease verification (POST /leases/{id}/verify).
grant update (
  reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
  initial_monthly_rental, current_monthly_rental, payment_due_day,
  escalation_type, escalation_percentage, escalation_fixed_amount, escalation_cpi_assumed_percentage,
  escalation_cpi_margin_percentage, escalation_frequency, first_escalation_date,
  renewal_option_exists, renewal_term_months, renewal_notice_period_months, renewal_notes,
  deposit_amount, deposit_basis_months, deposit_held_by, deposit_received_on, deposit_interest_bearing, deposit_notes,
  status, verified, previous_lease_id, notes
) on public.leases to authenticated;

revoke insert, update on public.lease_bank_guarantees from authenticated;
grant insert (company_id, lease_id, bank, reference_number, amount, basis_months, issued_on, expires_on, status, notes)
  on public.lease_bank_guarantees to authenticated;
grant update (bank, reference_number, amount, basis_months, issued_on, expires_on, status, notes)
  on public.lease_bank_guarantees to authenticated;

-- --------------------------------------------------------------------------- what counts as a lease term

-- Columns whose change makes verified terms unverified. Mirrors LEASE_TERM_FIELDS in @leaseguard/domain
-- (rules/leaseTerms.ts). Reference, notes, deposit receipt date and renewal notes are records, not terms.
create function private.lease_term_columns()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'tenant_id', 'property_id', 'unit_id', 'commencement_date', 'expiry_date',
    'initial_monthly_rental', 'current_monthly_rental', 'payment_due_day',
    'escalation_type', 'escalation_percentage', 'escalation_fixed_amount', 'escalation_cpi_assumed_percentage',
    'escalation_cpi_margin_percentage', 'escalation_frequency', 'first_escalation_date',
    'renewal_option_exists', 'renewal_term_months', 'renewal_notice_period_months',
    'deposit_amount', 'deposit_basis_months', 'deposit_held_by', 'deposit_interest_bearing'
  ]
$$;
revoke all on function private.lease_term_columns() from public, anon, authenticated;

-- Bank guarantee columns that are lease terms (status and notes are its lifecycle, not terms).
create function private.guarantee_term_columns()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['bank', 'reference_number', 'amount', 'basis_months', 'issued_on', 'expires_on']
$$;
revoke all on function private.guarantee_term_columns() from public, anon, authenticated;

-- Status of a lease whose verified terms changed. Mirrors leaseStatusAfterTermChange in @leaseguard/domain.
create function private.lease_status_after_term_change(p_status public.lease_status)
returns public.lease_status
language sql
immutable
set search_path = ''
as $$
  select case when p_status in ('active', 'expiring') then 'pending_verification'::public.lease_status else p_status end
$$;
revoke all on function private.lease_status_after_term_change(public.lease_status) from public, anon, authenticated;

-- --------------------------------------------------------------------------- guards

-- Applies to every role (the service role included): these are product rules, not permissions.
create function private.guard_lease_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parties_changed boolean := tg_op = 'INSERT'
    or new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.unit_id is distinct from old.unit_id;
begin
  if not v_parties_changed then
    return new;
  end if;

  -- SECURITY DEFINER runs before Row Level Security's WITH CHECK on INSERT: a signed-in caller who
  -- cannot write the target company is refused as RLS would, before another company's rows are read.
  if (select auth.uid()) is not null
     and not (new.company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'new row violates row-level security policy for table "leases"' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants t where t.company_id = new.company_id and t.id = new.tenant_id) then
    raise exception 'The tenant is not in this workspace' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.properties p where p.company_id = new.company_id and p.id = new.property_id) then
    raise exception 'The property is not in this workspace' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.units u where u.company_id = new.company_id and u.property_id = new.property_id and u.id = new.unit_id
  ) then
    raise exception 'The unit is not in the selected property' using errcode = 'P0001';
  end if;

  if (tg_op = 'INSERT' or new.property_id is distinct from old.property_id)
     and exists (
       select 1 from public.properties p
       where p.company_id = new.company_id and p.id = new.property_id and p.status = 'archived'
     ) then
    raise exception 'This property is archived. Restore it before adding leases to it.' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and (
       exists (select 1 from public.statements s where s.company_id = old.company_id and s.lease_id = old.id)
    or exists (select 1 from public.payment_arrangements a where a.company_id = old.company_id and a.lease_id = old.id)
    or exists (select 1 from public.monitoring_events e where e.company_id = old.company_id and e.lease_id = old.id)
    or exists (select 1 from public.communications c where c.company_id = old.company_id and c.lease_id = old.id)
    or exists (select 1 from public.units u where u.company_id = old.company_id and u.current_lease_id = old.id)
  ) then
    raise exception 'This lease already has statements, arrangements, monitoring events or messages, or is the unit''s current lease, so its tenant, property and unit cannot change.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_lease_change() from public, anon, authenticated;

create trigger guard_change before insert or update on public.leases
  for each row execute function private.guard_lease_change();

-- --------------------------------------------------------------------------- changed terms are unverified

-- Every role: a changed term of a verified lease is unverified, even when the same write sets verified.
-- Runs before stamp_verification (trigger names fire in order), which then sees the reset.
create function private.reset_lease_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.verified and exists (
    select 1 from unnest(private.lease_term_columns()) as f (field)
    where (to_jsonb(new) -> f.field) is distinct from (to_jsonb(old) -> f.field)
  ) then
    new.verified := false;
    new.verified_by_user_id := null;
    new.verified_at := null;
    new.status := private.lease_status_after_term_change(old.status);
  end if;
  return new;
end;
$$;
revoke all on function private.reset_lease_verification() from public, anon, authenticated;

create trigger reset_verification before update on public.leases
  for each row execute function private.reset_lease_verification();

-- --------------------------------------------------------------------------- audit

-- Verification itself (verified changed by POST /verify or a revoke) stays with audit_verification; this
-- trigger records creates and changes to the lease's fields, and says when a change reset verification.
create function private.audit_lease_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields constant text[] := array['reference'] || private.lease_term_columns() || array[
    'deposit_received_on', 'deposit_notes', 'renewal_notes', 'previous_lease_id', 'notes'
  ];
  v_old jsonb;
  v_new constant jsonb := to_jsonb(new);
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'create', 'lease', new.id,
      format('Lease %s created', new.reference),
      jsonb_build_array(
        private.field_change('reference', null::text, new.reference),
        private.field_change('status', null::text, new.status::text),
        private.field_change('verified', null::boolean, new.verified)
      )
    );
    return null;
  end if;

  v_old := to_jsonb(old);
  select jsonb_agg(
    jsonb_build_object('field', f.field, 'before', private.audit_scalar(v_old -> f.field), 'after', private.audit_scalar(v_new -> f.field))
    order by f.ordinality
  )
  into v_changes
  from unnest(v_fields) with ordinality as f (field, ordinality)
  where (v_old -> f.field) is distinct from (v_new -> f.field);

  if v_changes is null then
    return null;
  end if;

  if old.verified and not new.verified then
    v_changes := v_changes
      || private.field_change('verified', old.verified, new.verified)
      || private.field_change('status', old.status::text, new.status::text);
    perform private.write_audit(
      new.company_id, 'update', 'lease', new.id,
      format('Lease %s terms changed; verification reset', new.reference), v_changes
    );
  else
    perform private.write_audit(new.company_id, 'update', 'lease', new.id, format('Lease %s updated', new.reference), v_changes);
  end if;
  return null;
end;
$$;
revoke all on function private.audit_lease_change() from public, anon, authenticated;

create trigger audit_change after insert or update on public.leases
  for each row execute function private.audit_lease_change();

-- A bank guarantee added, changed or removed: audited on its lease, and a verified lease is unverified
-- again when a signed-in user changed a guarantee term. Skipped while the lease itself is being deleted (cascade).
create function private.guarantee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id constant uuid := coalesce(new.company_id, old.company_id);
  v_lease_id constant uuid := coalesce(new.lease_id, old.lease_id);
  v_old constant jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new constant jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_lease public.leases;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return null;
  end if;

  select jsonb_agg(
    jsonb_build_object('field', 'guarantee_' || f.field, 'before', v_old -> f.field, 'after', v_new -> f.field)
    order by f.ordinality
  )
  into v_changes
  from unnest(private.guarantee_term_columns()) with ordinality as f (field, ordinality)
  where (v_old -> f.field) is distinct from (v_new -> f.field);

  if v_changes is null then
    return null;
  end if;

  select * into v_lease from public.leases l where l.company_id = v_company_id and l.id = v_lease_id;
  if not found then
    return null;
  end if;

  perform private.write_audit(
    v_company_id, 'update', 'lease', v_lease_id,
    format('Lease %s bank guarantee %s', v_lease.reference,
      case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end),
    v_changes
  );

  -- audit_verification records the reset ("verification revoked"). Signed-in callers only: the service role
  -- loads a verified lease together with its guarantee (imports, fixtures) and is trusted to load both.
  if v_lease.verified and (select auth.uid()) is not null then
    update public.leases l
      set verified = false, status = private.lease_status_after_term_change(l.status)
      where l.company_id = v_company_id and l.id = v_lease_id;
  end if;
  return null;
end;
$$;
revoke all on function private.guarantee_change() from public, anon, authenticated;

create trigger guarantee_change after insert or update or delete on public.lease_bank_guarantees
  for each row execute function private.guarantee_change();

-- --------------------------------------------------------------------------- one write for a lease and its guarantee

-- Creates (p_lease_id null) or changes a lease and, when p_set_guarantee, sets (p_guarantee an object) or
-- removes (p_guarantee null) its bank guarantee, in one transaction. SECURITY INVOKER: the caller's grants,
-- RLS and every trigger above apply. On change, only keys present in p_lease are written (a present key with
-- null clears the column). Returns the lease id, or null when the lease is not visible to the caller.
create function public.save_lease(
  p_company_id uuid,
  p_lease jsonb,
  p_lease_id uuid default null,
  p_set_guarantee boolean default false,
  p_guarantee jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r constant public.leases := jsonb_populate_record(null::public.leases, coalesce(p_lease, '{}'::jsonb));
  g constant public.lease_bank_guarantees := jsonb_populate_record(null::public.lease_bank_guarantees, coalesce(p_guarantee, '{}'::jsonb));
  v_id uuid;
begin
  if p_lease_id is null then
    insert into public.leases (
      company_id, reference, property_id, unit_id, tenant_id, commencement_date, expiry_date,
      initial_monthly_rental, current_monthly_rental, payment_due_day,
      escalation_type, escalation_percentage, escalation_fixed_amount, escalation_cpi_assumed_percentage,
      escalation_cpi_margin_percentage, escalation_frequency, first_escalation_date,
      renewal_option_exists, renewal_term_months, renewal_notice_period_months, renewal_notes,
      deposit_amount, deposit_basis_months, deposit_held_by, deposit_received_on, deposit_interest_bearing, deposit_notes,
      status, notes
    ) values (
      p_company_id, r.reference, r.property_id, r.unit_id, r.tenant_id, r.commencement_date, r.expiry_date,
      r.initial_monthly_rental, r.current_monthly_rental, r.payment_due_day,
      r.escalation_type, r.escalation_percentage, r.escalation_fixed_amount, r.escalation_cpi_assumed_percentage,
      r.escalation_cpi_margin_percentage, r.escalation_frequency, r.first_escalation_date,
      coalesce(r.renewal_option_exists, false), r.renewal_term_months, r.renewal_notice_period_months, r.renewal_notes,
      r.deposit_amount, r.deposit_basis_months, r.deposit_held_by, r.deposit_received_on, r.deposit_interest_bearing, r.deposit_notes,
      coalesce(r.status, 'pending_verification'), r.notes
    )
    returning id into v_id;
  else
    update public.leases l set
      reference = case when p_lease ? 'reference' then r.reference else l.reference end,
      property_id = case when p_lease ? 'property_id' then r.property_id else l.property_id end,
      unit_id = case when p_lease ? 'unit_id' then r.unit_id else l.unit_id end,
      tenant_id = case when p_lease ? 'tenant_id' then r.tenant_id else l.tenant_id end,
      commencement_date = case when p_lease ? 'commencement_date' then r.commencement_date else l.commencement_date end,
      expiry_date = case when p_lease ? 'expiry_date' then r.expiry_date else l.expiry_date end,
      initial_monthly_rental = case when p_lease ? 'initial_monthly_rental' then r.initial_monthly_rental else l.initial_monthly_rental end,
      current_monthly_rental = case when p_lease ? 'current_monthly_rental' then r.current_monthly_rental else l.current_monthly_rental end,
      payment_due_day = case when p_lease ? 'payment_due_day' then r.payment_due_day else l.payment_due_day end,
      escalation_type = case when p_lease ? 'escalation_type' then r.escalation_type else l.escalation_type end,
      escalation_percentage = case when p_lease ? 'escalation_percentage' then r.escalation_percentage else l.escalation_percentage end,
      escalation_fixed_amount = case when p_lease ? 'escalation_fixed_amount' then r.escalation_fixed_amount else l.escalation_fixed_amount end,
      escalation_cpi_assumed_percentage = case when p_lease ? 'escalation_cpi_assumed_percentage' then r.escalation_cpi_assumed_percentage else l.escalation_cpi_assumed_percentage end,
      escalation_cpi_margin_percentage = case when p_lease ? 'escalation_cpi_margin_percentage' then r.escalation_cpi_margin_percentage else l.escalation_cpi_margin_percentage end,
      escalation_frequency = case when p_lease ? 'escalation_frequency' then r.escalation_frequency else l.escalation_frequency end,
      first_escalation_date = case when p_lease ? 'first_escalation_date' then r.first_escalation_date else l.first_escalation_date end,
      renewal_option_exists = case when p_lease ? 'renewal_option_exists' then r.renewal_option_exists else l.renewal_option_exists end,
      renewal_term_months = case when p_lease ? 'renewal_term_months' then r.renewal_term_months else l.renewal_term_months end,
      renewal_notice_period_months = case when p_lease ? 'renewal_notice_period_months' then r.renewal_notice_period_months else l.renewal_notice_period_months end,
      renewal_notes = case when p_lease ? 'renewal_notes' then r.renewal_notes else l.renewal_notes end,
      deposit_amount = case when p_lease ? 'deposit_amount' then r.deposit_amount else l.deposit_amount end,
      deposit_basis_months = case when p_lease ? 'deposit_basis_months' then r.deposit_basis_months else l.deposit_basis_months end,
      deposit_held_by = case when p_lease ? 'deposit_held_by' then r.deposit_held_by else l.deposit_held_by end,
      deposit_received_on = case when p_lease ? 'deposit_received_on' then r.deposit_received_on else l.deposit_received_on end,
      deposit_interest_bearing = case when p_lease ? 'deposit_interest_bearing' then r.deposit_interest_bearing else l.deposit_interest_bearing end,
      deposit_notes = case when p_lease ? 'deposit_notes' then r.deposit_notes else l.deposit_notes end,
      notes = case when p_lease ? 'notes' then r.notes else l.notes end
    where l.company_id = p_company_id and l.id = p_lease_id
    returning l.id into v_id;
    if v_id is null then
      return null;
    end if;
  end if;

  if p_set_guarantee then
    if p_guarantee is null or jsonb_typeof(p_guarantee) = 'null' then
      delete from public.lease_bank_guarantees bg where bg.company_id = p_company_id and bg.lease_id = v_id;
    else
      insert into public.lease_bank_guarantees as bg (
        company_id, lease_id, bank, reference_number, amount, basis_months, issued_on, expires_on, notes
      ) values (
        p_company_id, v_id, g.bank, g.reference_number, g.amount, g.basis_months, g.issued_on, g.expires_on, g.notes
      )
      on conflict (lease_id) do update set
        bank = excluded.bank,
        reference_number = excluded.reference_number,
        amount = excluded.amount,
        basis_months = excluded.basis_months,
        issued_on = excluded.issued_on,
        expires_on = excluded.expires_on,
        notes = excluded.notes;
    end if;
  end if;

  return v_id;
end;
$$;
comment on function public.save_lease(uuid, jsonb, uuid, boolean, jsonb) is
  'Creates or changes a lease and its bank guarantee in one transaction, under the caller''s RLS and grants.';
revoke execute on function public.save_lease(uuid, jsonb, uuid, boolean, jsonb) from public, anon;
grant execute on function public.save_lease(uuid, jsonb, uuid, boolean, jsonb) to authenticated, service_role;
