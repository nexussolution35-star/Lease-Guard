-- Tenant management (PRD module 4, ticket M4-01): create and edit tenants, all audited.
--
-- Writers (company_admin, property_manager) already held table-wide INSERT, UPDATE and DELETE on
-- tenants through RLS. This migration narrows that to what the product allows:
--   * no hard delete: a tenant keeps its leases, statements and communication history; a tenant
--     who left is marked vacated;
--   * column grants: the company and the timestamps are fixed; the WhatsApp validation and opt-out
--     flags are not written by signed-in users (validation and opt-outs have their own paths);
--   * a changed WhatsApp number is unvalidated again (PRD §5.4: numbers must be validated before
--     automated communication is enabled), whoever changes it, unless the same write sets the flag
--     itself (the service role recording a number it has already validated);
--   * audit: create and update are recorded with the signed-in user as actor; a number change
--     says that validation was reset.

-- --------------------------------------------------------------------------- privileges

revoke insert, update, delete on public.tenants from authenticated;
grant insert (
  company_id, legal_name, trading_name, business_type, registration_number, vat_number,
  contact_full_name, contact_role, contact_phone, contact_email,
  whatsapp_number, email, status, industry, notes
) on public.tenants to authenticated;
grant update (
  legal_name, trading_name, business_type, registration_number, vat_number,
  contact_full_name, contact_role, contact_phone, contact_email,
  whatsapp_number, email, status, industry, notes
) on public.tenants to authenticated;

-- --------------------------------------------------------------------------- a new number is unvalidated

create function private.reset_tenant_whatsapp_validation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp_verified is not distinct from old.whatsapp_verified then
    new.whatsapp_verified := false;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_tenant_whatsapp_validation() from public, anon, authenticated;

create trigger reset_whatsapp_validation before update of whatsapp_number on public.tenants
  for each row when (old.whatsapp_number is distinct from new.whatsapp_number)
  execute function private.reset_tenant_whatsapp_validation();

-- --------------------------------------------------------------------------- audit

create function private.audit_tenant_change()
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
    new.company_id, 'update', 'tenant', new.id,
    case
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

create trigger audit_change after insert or update on public.tenants
  for each row execute function private.audit_tenant_change();
