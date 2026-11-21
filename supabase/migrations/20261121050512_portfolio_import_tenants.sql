-- Portfolio import, ticket I-05 (tenants from the register): when the file also has tenant columns, the preview
-- proposes each unit's tenant, matched to an existing tenant only by an exact registration number or account
-- reference; a tenant with a similar name is a suggestion the manager confirms or rejects on the batch row. Approval
-- creates the new tenants with the batch, in the same transaction, through the tenants table's own column grants, RLS
-- policies, triggers and audit (the tenant write path, no second data model).
--
--   * tenants.account_reference: the tenant's account reference in the company's own system (a register's tenant or
--     debtor code), unique per company whatever its case, written like the other tenant columns;
--   * portfolio_import_rows.linked_tenant_id / tenant_suggestions_rejected: the manager's decision on a suggested
--     match (the existing tenant the row's tenant is, or "none of these: a new tenant"), kept on the batch row,
--     stamped with who decided and when, and audited with the previous and new value;
--   * portfolio_import_records: also lists every tenant an import created, with its unit (record type 'tenant');
--   * apply_portfolio_import takes the tenants to create (p_tenants) besides the properties and units; each is the
--     tenant of a unit the row names (existing, or created by the same call). A created tenant's WhatsApp number starts
--     unvalidated, as every new tenant's does, so automated communication stays off;
--   * audit: each created tenant is recorded as created by import with the batch reference, and the approval entry
--     counts the tenants created.
-- Importing never sends WhatsApp or any other message: nothing here writes communications, approvals or schedules.

-- --------------------------------------------------------------------------- the tenant's account reference

alter table public.tenants
  add column account_reference text
    constraint tenants_account_reference_check check (account_reference is null or length(btrim(account_reference)) between 1 and 50);
comment on column public.tenants.account_reference is
  'The tenant''s account reference in the company''s own system (tenant or debtor code); unique per company, case ignored.';

create unique index tenants_company_account_reference_key on public.tenants (company_id, upper(account_reference))
  where account_reference is not null;
create index tenants_company_registration_number_idx on public.tenants (company_id, registration_number)
  where registration_number is not null;

grant insert (account_reference) on public.tenants to authenticated;
grant update (account_reference) on public.tenants to authenticated;

-- --------------------------------------------------------------------------- the manager's decision on a suggested tenant

alter table public.portfolio_import_rows
  add column linked_tenant_id uuid,
  add column tenant_suggestions_rejected boolean not null default false,
  add constraint portfolio_import_rows_linked_tenant_fk foreign key (company_id, linked_tenant_id)
    references public.tenants (company_id, id) on delete set null (linked_tenant_id),
  add constraint portfolio_import_rows_tenant_decision_check check (not (tenant_suggestions_rejected and linked_tenant_id is not null));
create index portfolio_import_rows_linked_tenant_idx on public.portfolio_import_rows (company_id, linked_tenant_id)
  where linked_tenant_id is not null;
comment on column public.portfolio_import_rows.linked_tenant_id is
  'The existing tenant the manager confirmed the row''s tenant is: no tenant is created for it and the file''s tenant values are not used.';
comment on column public.portfolio_import_rows.tenant_suggestions_rejected is
  'The manager rejected the tenants suggested for the row (similar names): the row''s tenant is created as a new tenant.';

grant update (linked_tenant_id, tenant_suggestions_rejected) on public.portfolio_import_rows to authenticated;

-- The row guard (20261121014523), with the tenant decision stamped like the other changes.
create or replace function private.guard_portfolio_import_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
  v_unit_property uuid;
begin
  if new.corrections is not distinct from old.corrections
    and new.skipped is not distinct from old.skipped
    and new.linked_property_id is not distinct from old.linked_property_id
    and new.linked_unit_id is not distinct from old.linked_unit_id
    and new.linked_tenant_id is not distinct from old.linked_tenant_id
    and new.tenant_suggestions_rejected is not distinct from old.tenant_suggestions_rejected then
    return new;
  end if;

  if (select auth.uid()) is not null then
    new.changed_by_user_id := (select auth.uid());
    new.changed_at := now();
  else
    new.changed_at := coalesce(new.changed_at, now());
  end if;

  select * into v_import from public.portfolio_imports i where i.company_id = new.company_id and i.id = new.import_id;

  if v_import.scope = 'units' and new.linked_property_id is not null then
    raise exception 'This import adds units to one property: link the row to one of its units' using errcode = 'P0001';
  end if;

  if new.linked_unit_id is not null then
    select u.property_id into v_unit_property from public.units u
    where u.company_id = new.company_id and u.id = new.linked_unit_id;
    if v_unit_property is distinct from coalesce(new.linked_property_id, v_import.property_id) then
      raise exception 'The unit linked to the row must be one of the property linked to it' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- The row audit (20261121014523), with the tenant decision recorded like the other changes.
create or replace function private.audit_portfolio_import_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
  v_changes jsonb := '[]';
  v_parts text[] := '{}';
  v_field text;
  v_before text;
  v_after text;
  v_name text;
begin
  select * into v_import from public.portfolio_imports i where i.company_id = new.company_id and i.id = new.import_id;

  for v_field in
    select key from jsonb_object_keys(old.corrections) as key
    union
    select key from jsonb_object_keys(new.corrections) as key
    order by 1
  loop
    if (old.corrections -> v_field) is distinct from (new.corrections -> v_field) then
      v_before := case when old.corrections ? v_field then old.corrections ->> v_field
        else private.portfolio_import_cell(v_import, old.cells, v_field) end;
      v_after := case when new.corrections ? v_field then new.corrections ->> v_field
        else private.portfolio_import_cell(v_import, new.cells, v_field) end;
      v_changes := v_changes || jsonb_build_array(private.field_change(format('row %s %s', new.row_number, v_field), v_before, v_after));
      v_parts := v_parts || format('%s %s', v_field, case when new.corrections ? v_field then 'corrected' else 'back to the file''s value' end);
    end if;
  end loop;

  if new.skipped is distinct from old.skipped then
    v_changes := v_changes || jsonb_build_array(private.field_change(format('row %s skipped', new.row_number), old.skipped, new.skipped));
    v_parts := v_parts || case when new.skipped then 'skipped' else 'included again' end;
  end if;

  if new.linked_property_id is distinct from old.linked_property_id then
    v_changes := v_changes || jsonb_build_array(
      private.field_change(format('row %s linkedPropertyId', new.row_number), old.linked_property_id, new.linked_property_id));
    select p.name into v_name from public.properties p where p.company_id = new.company_id and p.id = new.linked_property_id;
    v_parts := v_parts || case when new.linked_property_id is null then 'property link removed' else format('linked to %s', v_name) end;
  end if;

  if new.linked_unit_id is distinct from old.linked_unit_id then
    v_changes := v_changes || jsonb_build_array(
      private.field_change(format('row %s linkedUnitId', new.row_number), old.linked_unit_id, new.linked_unit_id));
    select u.unit_number into v_name from public.units u where u.company_id = new.company_id and u.id = new.linked_unit_id;
    v_parts := v_parts || case when new.linked_unit_id is null then 'unit link removed' else format('linked to unit %s', v_name) end;
  end if;

  if new.linked_tenant_id is distinct from old.linked_tenant_id then
    v_changes := v_changes || jsonb_build_array(
      private.field_change(format('row %s linkedTenantId', new.row_number), old.linked_tenant_id, new.linked_tenant_id));
    select t.trading_name into v_name from public.tenants t where t.company_id = new.company_id and t.id = new.linked_tenant_id;
    v_parts := v_parts || case when new.linked_tenant_id is null then 'tenant match withdrawn' else format('tenant confirmed as %s', v_name) end;
  end if;

  if new.tenant_suggestions_rejected is distinct from old.tenant_suggestions_rejected then
    v_changes := v_changes || jsonb_build_array(
      private.field_change(format('row %s tenantSuggestionsRejected', new.row_number), old.tenant_suggestions_rejected, new.tenant_suggestions_rejected));
    v_parts := v_parts || case when new.tenant_suggestions_rejected then 'suggested tenants rejected' else 'tenant rejection withdrawn' end;
  end if;

  if jsonb_array_length(v_changes) > 0 then
    perform private.write_audit(
      new.company_id, 'update', 'portfolio_import', new.import_id,
      format('Row %s of portfolio file %s: %s', new.row_number, v_import.file_name, array_to_string(v_parts, ', ')),
      v_changes
    );
  end if;
  return null;
end;
$$;

-- --------------------------------------------------------------------------- created tenants

alter table public.portfolio_import_records
  drop constraint portfolio_import_records_record_type_check,
  drop constraint portfolio_import_records_unit_check,
  add column tenant_id uuid,
  add constraint portfolio_import_records_record_type_check check (record_type in ('property', 'unit', 'tenant')),
  -- A property record names its property; a unit record its unit; a tenant record the tenant and its unit.
  add constraint portfolio_import_records_record_check check (
    case record_type
      when 'property' then unit_id is null and tenant_id is null
      when 'unit' then unit_id is not null and tenant_id is null
      else unit_id is not null and tenant_id is not null
    end
  ),
  add constraint portfolio_import_records_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id) on delete cascade;
drop index public.portfolio_import_records_unit_key;
create unique index portfolio_import_records_unit_key on public.portfolio_import_records (unit_id) where record_type = 'unit';
create unique index portfolio_import_records_tenant_key on public.portfolio_import_records (tenant_id) where tenant_id is not null;
-- A batch row creates its tenant once: a second approval finds it (the API matches the row to it) or is refused.
create unique index portfolio_import_records_row_tenant_key on public.portfolio_import_records (import_id, row_number)
  where record_type = 'tenant';
create index portfolio_import_records_unit_idx on public.portfolio_import_records (company_id, unit_id) where unit_id is not null;
comment on table public.portfolio_import_records is
  'Every property, unit and tenant a portfolio import created, with its batch and row (a tenant with its unit). Written by triggers while apply_portfolio_import runs; members read.';

-- The unit the tenant being inserted is the tenant of, when apply_portfolio_import set it.
create function private.applying_portfolio_import_unit()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('leaseguard.portfolio_import_unit', true), '')::uuid
$$;
revoke all on function private.applying_portfolio_import_unit() from public, anon, authenticated;

-- Records the tenant just inserted against the batch being applied (of the same company), with its unit.
create function private.record_portfolio_import_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.portfolio_imports := private.applying_portfolio_import_of(new.company_id);
  v_unit public.units;
begin
  if v_import.id is null then
    return null;
  end if;
  select * into v_unit from public.units u where u.company_id = new.company_id and u.id = private.applying_portfolio_import_unit();
  if v_unit.id is null then
    raise exception 'An imported tenant must be the tenant of a unit of the company' using errcode = '22023';
  end if;
  insert into public.portfolio_import_records (company_id, import_id, row_number, record_type, property_id, unit_id, tenant_id)
  values (new.company_id, v_import.id, coalesce(private.applying_portfolio_import_row(), 1), 'tenant', v_unit.property_id, v_unit.id, new.id);
  return null;
end;
$$;
revoke all on function private.record_portfolio_import_tenant() from public, anon, authenticated;

create trigger record_portfolio_import after insert on public.tenants
  for each row execute function private.record_portfolio_import_tenant();

-- --------------------------------------------------------------------------- audit: created by import

-- The tenant audit trigger (20261120232243), with the account reference audited and a created tenant marked as
-- created by import with the batch reference when an import is being applied. Updates are unchanged otherwise.
create or replace function private.audit_tenant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields constant text[] := array[
    'legal_name', 'trading_name', 'business_type', 'registration_number', 'account_reference', 'vat_number',
    'contact_full_name', 'contact_role', 'contact_phone', 'contact_email',
    'whatsapp_number', 'whatsapp_verified', 'whatsapp_opted_out', 'email', 'status', 'industry', 'notes'
  ];
  v_old jsonb;
  v_new constant jsonb := to_jsonb(new);
  v_changes jsonb;
  v_validated constant boolean := tg_op = 'UPDATE' and new.whatsapp_verified and not old.whatsapp_verified;
  v_import public.portfolio_imports;
begin
  if tg_op = 'INSERT' then
    v_import := private.applying_portfolio_import_of(new.company_id);
    perform private.write_audit(
      new.company_id, 'create', 'tenant', new.id,
      case when v_import.id is null then format('Tenant %s created', new.trading_name)
        else format('Tenant %s created by import of %s, row %s', new.trading_name, v_import.file_name,
          private.applying_portfolio_import_row()) end,
      jsonb_build_array(
        private.field_change('legal_name', null::text, new.legal_name),
        private.field_change('trading_name', null::text, new.trading_name),
        private.field_change('whatsapp_number', null::text, new.whatsapp_number),
        private.field_change('status', null::text, new.status::text)
      ) || case when v_import.id is null then '[]'::jsonb else jsonb_build_array(
        private.field_change('portfolioImportId', null::uuid, v_import.id),
        private.field_change('portfolioImportRow', null::integer, private.applying_portfolio_import_row())
      ) end
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

-- The batch's audit trigger (20261121034217), with the tenants an approval created counted. Unchanged otherwise.
create or replace function private.audit_portfolio_import()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_properties integer;
  v_units integer;
  v_tenants integer;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'upload', 'portfolio_import', new.id,
      format('Portfolio file %s uploaded: %s %s', new.file_name, new.row_count, case when new.row_count = 1 then 'row' else 'rows' end),
      jsonb_build_array(
        private.field_change('fileName', null::text, new.file_name),
        private.field_change('scope', null::text, new.scope),
        private.field_change('sheetName', null::text, new.sheet_name),
        private.field_change('rowCount', null::integer, new.row_count)
      )
    );
    return null;
  end if;

  if new.approved_at is distinct from old.approved_at then
    -- The records this approval created: written earlier in the same transaction (created_at is its start time).
    select count(*) filter (where r.record_type = 'property'), count(*) filter (where r.record_type = 'unit'),
      count(*) filter (where r.record_type = 'tenant')
    into v_properties, v_units, v_tenants
    from public.portfolio_import_records r
    where r.company_id = new.company_id and r.import_id = new.id and r.created_at = now();
    perform private.write_audit(
      new.company_id, 'approve', 'portfolio_import', new.id,
      case when v_tenants = 0 then
        format('Portfolio file %s approved: %s %s and %s %s created', new.file_name,
          v_properties, case when v_properties = 1 then 'property' else 'properties' end,
          v_units, case when v_units = 1 then 'unit' else 'units' end)
      else
        format('Portfolio file %s approved: %s %s, %s %s and %s %s created', new.file_name,
          v_properties, case when v_properties = 1 then 'property' else 'properties' end,
          v_units, case when v_units = 1 then 'unit' else 'units' end,
          v_tenants, case when v_tenants = 1 then 'tenant' else 'tenants' end)
      end,
      jsonb_build_array(
        private.field_change('approvedAt', old.approved_at, new.approved_at),
        private.field_change('propertiesCreated', null::integer, v_properties),
        private.field_change('unitsCreated', null::integer, v_units)
      ) || case when v_tenants = 0 then '[]'::jsonb
        else jsonb_build_array(private.field_change('tenantsCreated', null::integer, v_tenants)) end
    );
  elsif new.sheet_name is distinct from old.sheet_name then
    perform private.write_audit(
      new.company_id, 'update', 'portfolio_import', new.id,
      format('Portfolio file %s now read from the sheet %s', new.file_name, new.sheet_name),
      jsonb_build_array(
        private.field_change('sheetName', old.sheet_name, new.sheet_name),
        private.field_change('rowCount', old.row_count, new.row_count)
      )
    );
  elsif new.column_mapping is not null and new.column_mapping is distinct from old.column_mapping then
    perform private.write_audit(
      new.company_id, 'update', 'portfolio_import', new.id,
      format('Column mapping applied to portfolio file %s', new.file_name),
      jsonb_build_array(private.field_change('columnMapping', old.column_mapping, new.column_mapping))
    );
  end if;
  return null;
end;
$$;

-- --------------------------------------------------------------------------- write function

drop function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb);

-- p_properties and p_units: as before (20261121034217).
-- p_tenants: [{"row_number": 2, "unit_id": <existing unit> | null, "property_id": <existing property> | null,
--              "property_code": <a property of p_properties> | null, "unit_number": <the unit, when unit_id is null>,
--              <every tenants insert column of the tenant form>}, …]
-- Built by the API from the rows checked against the live records, with the tenant form's validation. Each tenant is
-- the tenant of the unit its row names. Returns the batch with its approval.
create function public.apply_portfolio_import(
  p_company_id uuid,
  p_import_id uuid,
  p_properties jsonb,
  p_units jsonb,
  p_tenants jsonb default '[]'
)
returns public.portfolio_imports
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
  v_item jsonb;
  v_property public.properties;
  v_unit public.units;
  v_tenant public.tenants;
  v_property_id uuid;
  v_unit_id uuid;
  v_created jsonb := '{}';
begin
  if jsonb_typeof(p_properties) is distinct from 'array' or jsonb_typeof(p_units) is distinct from 'array'
    or jsonb_typeof(p_tenants) is distinct from 'array' then
    raise exception 'p_properties, p_units and p_tenants must be JSON arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(p_properties) + jsonb_array_length(p_units) + jsonb_array_length(p_tenants) = 0 then
    raise exception 'Nothing to import' using errcode = '22023';
  end if;

  -- One approval of a batch at a time; the second waits and then finds the records already there (unique keys).
  select * into v_import from public.portfolio_imports i
  where i.company_id = p_company_id and i.id = p_import_id
  for update;
  if v_import.id is null then
    raise exception 'Portfolio import not found' using errcode = 'P0002';
  end if;
  if v_import.scope = 'units' and jsonb_array_length(p_properties) > 0 then
    raise exception 'This import adds units to one property' using errcode = '22023';
  end if;

  perform set_config('leaseguard.portfolio_import_id', p_import_id::text, true);

  for v_item in select value from jsonb_array_elements(p_properties) loop
    v_property := jsonb_populate_record(null::public.properties, v_item);
    perform set_config('leaseguard.portfolio_import_row', (v_item ->> 'row_number')::integer::text, true);
    insert into public.properties (
      company_id, name, code, type, status,
      address_line1, address_line2, suburb, city, province, postal_code,
      description, gross_lettable_area_sqm, manager_user_id, owner_user_id, accounting_system
    )
    values (
      p_company_id, v_property.name, v_property.code, v_property.type, coalesce(v_property.status, 'active'),
      v_property.address_line1, v_property.address_line2, v_property.suburb, v_property.city, v_property.province,
      v_property.postal_code, coalesce(v_property.description, ''), v_property.gross_lettable_area_sqm,
      v_property.manager_user_id, v_property.owner_user_id, v_property.accounting_system
    )
    returning id into v_property_id;
    v_created := v_created || jsonb_build_object(v_property.code, v_property_id);
  end loop;

  for v_item in select value from jsonb_array_elements(p_units) loop
    v_unit := jsonb_populate_record(null::public.units, v_item);
    v_property_id := case
      when v_import.scope = 'units' then v_import.property_id
      when v_item ->> 'property_code' is not null then (v_created ->> (v_item ->> 'property_code'))::uuid
      else v_unit.property_id
    end;
    if v_property_id is null then
      raise exception 'A unit names a property that is neither in LeaseGuard nor created by this import' using errcode = '22023';
    end if;
    perform set_config('leaseguard.portfolio_import_row', (v_item ->> 'row_number')::integer::text, true);
    insert into public.units (company_id, property_id, unit_number, type, floor_area_sqm, floor, occupancy_status, description)
    values (
      p_company_id, v_property_id, v_unit.unit_number, v_unit.type, v_unit.floor_area_sqm, v_unit.floor,
      coalesce(v_unit.occupancy_status, 'vacant'), v_unit.description
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_tenants) loop
    v_tenant := jsonb_populate_record(null::public.tenants, v_item);
    if v_item ->> 'unit_id' is not null then
      select u.id into v_unit_id from public.units u where u.company_id = p_company_id and u.id = (v_item ->> 'unit_id')::uuid;
    else
      v_property_id := case
        when v_import.scope = 'units' then v_import.property_id
        when v_item ->> 'property_code' is not null then (v_created ->> (v_item ->> 'property_code'))::uuid
        else (v_item ->> 'property_id')::uuid
      end;
      select u.id into v_unit_id from public.units u
      where u.company_id = p_company_id and u.property_id = v_property_id and u.unit_number = v_item ->> 'unit_number';
    end if;
    if v_unit_id is null then
      raise exception 'A tenant names a unit that is neither in LeaseGuard nor created by this import' using errcode = '22023';
    end if;
    perform set_config('leaseguard.portfolio_import_row', (v_item ->> 'row_number')::integer::text, true);
    perform set_config('leaseguard.portfolio_import_unit', v_unit_id::text, true);
    insert into public.tenants (
      company_id, legal_name, trading_name, business_type, registration_number, account_reference, vat_number,
      contact_full_name, contact_role, contact_phone, contact_email, whatsapp_number, email, status, industry, notes
    )
    values (
      p_company_id, v_tenant.legal_name, v_tenant.trading_name, v_tenant.business_type, v_tenant.registration_number,
      v_tenant.account_reference, v_tenant.vat_number, v_tenant.contact_full_name, coalesce(v_tenant.contact_role, ''),
      v_tenant.contact_phone, v_tenant.contact_email, v_tenant.whatsapp_number, v_tenant.email,
      coalesce(v_tenant.status, 'prospective'), coalesce(v_tenant.industry, ''), v_tenant.notes
    );
    v_unit_id := null;
  end loop;

  update public.portfolio_imports set approved_at = now()
  where company_id = p_company_id and id = p_import_id
  returning * into v_import;

  perform set_config('leaseguard.portfolio_import_unit', '', true);
  perform set_config('leaseguard.portfolio_import_row', '', true);
  perform set_config('leaseguard.portfolio_import_id', '', true);
  return v_import;
end;
$$;
revoke all on function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
comment on function public.apply_portfolio_import(uuid, uuid, jsonb, jsonb, jsonb) is
  'Company admins and property managers (RLS). Creates the approved properties, units and tenants of a portfolio import in one transaction and stamps the approval.';
