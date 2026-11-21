-- Validating a tenant's WhatsApp number (PRD §5.4, ticket M4-03): numbers must be validated before
-- automated communication is enabled.
--
-- A company writer confirms that the number on record is the tenant's WhatsApp number. Signed-in users
-- still cannot write `whatsapp_verified` (M4-01 column grants); they validate through
-- `public.validate_tenant_whatsapp_number`, which validates only the number the person checked, so a
-- number changed in the meantime is never validated by mistake.
--   * `whatsapp_validated_at` and `whatsapp_validated_by_user_id` record the sign-off: stamped when the
--     flag turns on, cleared whenever it turns off (including the reset after a number change);
--   * the audit entry for a validation is a `verify` action naming the tenant.

-- --------------------------------------------------------------------------- who validated the number, and when

alter table public.tenants
  add column whatsapp_validated_at timestamptz,
  add column whatsapp_validated_by_user_id uuid references public.profiles (id) on delete set null,
  add constraint tenants_whatsapp_validation_check
    check (whatsapp_verified or (whatsapp_validated_at is null and whatsapp_validated_by_user_id is null));

comment on column public.tenants.whatsapp_validated_at is
  'When the current WhatsApp number was validated; null while it is not (or for numbers validated before this was recorded).';
comment on column public.tenants.whatsapp_validated_by_user_id is
  'The member who validated the current WhatsApp number; null for a background job or when not validated.';

-- Runs after reset_whatsapp_validation (triggers fire in name order), so a number change that reset the
-- flag also clears the sign-off. No column list: the reset changes the flag without naming it in SET.
create function private.stamp_tenant_whatsapp_validation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp_verified and not old.whatsapp_verified then
    new.whatsapp_validated_by_user_id := coalesce((select auth.uid()), new.whatsapp_validated_by_user_id);
    new.whatsapp_validated_at := case when (select auth.uid()) is null then coalesce(new.whatsapp_validated_at, now()) else now() end;
  elsif not new.whatsapp_verified then
    new.whatsapp_validated_by_user_id := null;
    new.whatsapp_validated_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_tenant_whatsapp_validation() from public, anon, authenticated;

create trigger stamp_whatsapp_validation before update on public.tenants
  for each row execute function private.stamp_tenant_whatsapp_validation();

-- --------------------------------------------------------------------------- validating a number

create function public.validate_tenant_whatsapp_number(p_company_id uuid, p_tenant_id uuid, p_whatsapp_number text)
returns table (outcome text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant public.tenants;
begin
  if (select auth.uid()) is null or not private.can_write(p_company_id) then
    raise exception 'Only company admins and property managers can validate WhatsApp numbers' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants t
  where t.company_id = p_company_id and t.id = p_tenant_id
  for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_tenant.whatsapp_number is distinct from p_whatsapp_number then
    return query select 'number_changed'::text;
    return;
  end if;
  if v_tenant.whatsapp_verified then
    return query select 'already_validated'::text;
    return;
  end if;

  update public.tenants set whatsapp_verified = true where id = p_tenant_id;
  return query select 'validated'::text;
end;
$$;
revoke all on function public.validate_tenant_whatsapp_number(uuid, uuid, text) from public, anon;
grant execute on function public.validate_tenant_whatsapp_number(uuid, uuid, text) to authenticated;
comment on function public.validate_tenant_whatsapp_number(uuid, uuid, text) is
  'A company writer validates the tenant''s WhatsApp number p_whatsapp_number (E.164), which must still be the number on record. '
  'Outcome: validated, already_validated, number_changed or not_found. Audited as verify.';

-- --------------------------------------------------------------------------- audit: a validation reads as such

create or replace function private.audit_tenant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields constant text[] := array[
    'legal_name', 'trading_name', 'business_type', 'registration_number', 'vat_number',
    'contact_full_name', 'contact_role', 'contact_phone', 'contact_email',
    'whatsapp_number', 'whatsapp_verified', 'whatsapp_opted_out', 'email', 'status', 'industry', 'notes'
  ];
  v_old jsonb;
  v_new constant jsonb := to_jsonb(new);
  v_changes jsonb;
  v_validated constant boolean := tg_op = 'UPDATE' and new.whatsapp_verified and not old.whatsapp_verified;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'create', 'tenant', new.id,
      format('Tenant %s created', new.trading_name),
      jsonb_build_array(
        private.field_change('legal_name', null::text, new.legal_name),
        private.field_change('trading_name', null::text, new.trading_name),
        private.field_change('whatsapp_number', null::text, new.whatsapp_number),
        private.field_change('status', null::text, new.status::text)
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

  perform private.write_audit(
    new.company_id, case when v_validated then 'verify' else 'update' end, 'tenant', new.id,
    case
      when v_validated and new.whatsapp_number is not distinct from old.whatsapp_number
        then format('Tenant %s: WhatsApp number %s validated', new.trading_name, new.whatsapp_number)
      when new.whatsapp_number is distinct from old.whatsapp_number and not new.whatsapp_verified
        then format('Tenant %s: WhatsApp number changed; it must be validated again', new.trading_name)
      else format('Tenant %s updated', new.trading_name)
    end,
    v_changes
  );
  return null;
end;
$$;
revoke all on function private.audit_tenant_change() from public, anon, authenticated;
