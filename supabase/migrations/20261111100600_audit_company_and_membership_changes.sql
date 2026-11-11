-- Audit company configuration and membership management (PRD 5.1 "audit logging", 8.5 "user actions").
--
-- Until now the audit log recorded invitations but not what happened next: a company admin could change
-- the company's details or its monitoring settings (notice periods, reminder timing), change a member's
-- role or remove a member, and Settings -> Audit log showed nothing. The AFTER triggers below append the
-- audit_logs row in the same transaction; the actor is auth.uid() (private.write_audit), never client input.

-- --------------------------------------------------------------------------- companies

-- A before/after value as a FieldChange scalar: arrays (notice days) become '180, 90, 30'.
create function private.audit_scalar(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(p_value)
    when 'array' then to_jsonb((select coalesce(string_agg(item, ', '), '') from jsonb_array_elements_text(p_value) as item))
    when 'object' then to_jsonb(p_value::text)
    else p_value
  end
$$;
revoke all on function private.audit_scalar(jsonb) from public, anon, authenticated;

create function private.audit_company_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Monitoring and communication settings; every other audited column is the company's profile.
  v_settings constant text[] := array[
    'lease_expiry_notice_days', 'renewal_deadline_warning_days', 'guarantee_expiry_notice_days',
    'payment_reminder_initial_days', 'payment_reminder_overdue_days', 'payment_reminder_follow_up_days',
    'installment_reminder_lead_days', 'owner_summary_weekday'
  ];
  v_profile constant text[] := array[
    'name', 'trading_name', 'registration_number', 'vat_number',
    'address_line1', 'address_line2', 'suburb', 'city', 'province', 'postal_code',
    'contact_email', 'contact_phone', 'status', 'initials'
  ];
  v_old constant jsonb := to_jsonb(old);
  v_new constant jsonb := to_jsonb(new);
  v_changes jsonb;
  v_settings_only boolean;
begin
  select
    jsonb_agg(
      jsonb_build_object('field', c.field, 'before', private.audit_scalar(v_old -> c.field), 'after', private.audit_scalar(v_new -> c.field))
      order by c.ordinality
    ),
    bool_and(c.field = any (v_settings))
  into v_changes, v_settings_only
  from unnest(v_profile || v_settings) with ordinality as c (field, ordinality)
  where (v_old -> c.field) is distinct from (v_new -> c.field);

  if v_changes is null then
    return null;
  end if;
  perform private.write_audit(
    new.id, 'update', 'company', new.id,
    case when v_settings_only then 'Notice periods and reminder timing updated' else 'Company details updated' end,
    v_changes
  );
  return null;
end;
$$;
revoke all on function private.audit_company_change() from public, anon, authenticated;

create trigger audit_change after update on public.companies
  for each row execute function private.audit_company_change();

-- --------------------------------------------------------------------------- company_users

create function private.audit_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select coalesce(nullif(p.full_name, ''), p.email) into v_name
  from public.profiles p
  where p.id = old.user_id;
  v_name := coalesce(v_name, 'A member');

  if tg_op = 'DELETE' then
    -- Only a removal by a signed-in user is an audited action. Rows that disappear because their user or
    -- company is being deleted (service role, cascades) are not: an audit row would also pin the company.
    if (select auth.uid()) is null then
      return null;
    end if;
    perform private.write_audit(
      old.company_id, 'delete', 'user', old.user_id,
      format('Removed %s from the workspace', v_name),
      jsonb_build_array(private.field_change('role', old.role::text, null::text))
    );
  else
    perform private.write_audit(
      new.company_id, 'update', 'user', new.user_id,
      format('Changed the role of %s from %s to %s', v_name, replace(old.role::text, '_', ' '), replace(new.role::text, '_', ' ')),
      jsonb_build_array(private.field_change('role', old.role::text, new.role::text))
    );
  end if;
  return null;
end;
$$;
revoke all on function private.audit_membership_change() from public, anon, authenticated;

create trigger audit_role_change after update of role on public.company_users
  for each row when (old.role is distinct from new.role)
  execute function private.audit_membership_change();
create trigger audit_removal after delete on public.company_users
  for each row execute function private.audit_membership_change();
