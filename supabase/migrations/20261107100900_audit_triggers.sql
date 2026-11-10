-- Audited state changes: lease verification, statement verification and correction, extraction
-- review and field corrections, monitoring event resolution or dismissal, and message approval
-- decisions. BEFORE triggers stamp the acting user (auth.uid()) so the actor cannot be forged by
-- the client; AFTER triggers append the audit_logs row in the same transaction.
-- When auth.uid() is NULL (backend job using the service role) the supplied actor columns are kept
-- and the audit row has no actor.

-- Action and entity type are passed as text (trigger CASE expressions yield text) and cast to
-- their enums here, so an unknown value still fails.
create function private.write_audit(
  p_company_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_summary text,
  p_changes jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, summary, changes)
  values (
    p_company_id, (select auth.uid()), p_action::public.audit_action, p_entity_type::public.entity_type,
    p_entity_id, p_summary, p_changes
  )
$$;
revoke all on function private.write_audit(uuid, text, text, uuid, text, jsonb) from public;

create function private.field_change(p_field text, p_before anyelement, p_after anyelement)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('field', p_field, 'before', to_jsonb(p_before), 'after', to_jsonb(p_after))
$$;

-- --------------------------------------------------------------------------- leases: verification

create function private.stamp_lease_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.verified and not old.verified then
    new.verified_by_user_id := coalesce((select auth.uid()), new.verified_by_user_id);
    new.verified_at := case when (select auth.uid()) is null then coalesce(new.verified_at, now()) else now() end;
  elsif not new.verified then
    new.verified_by_user_id := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;
create trigger stamp_verification before update of verified on public.leases
  for each row when (old.verified is distinct from new.verified)
  execute function private.stamp_lease_verification();

create function private.audit_lease_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id,
    case when new.verified then 'verify' else 'update' end,
    'lease',
    new.id,
    format('Lease %s %s', new.reference, case when new.verified then 'terms verified' else 'verification revoked' end),
    jsonb_build_array(private.field_change('verified', old.verified, new.verified))
  );
  return null;
end;
$$;
create trigger audit_verification after update of verified on public.leases
  for each row when (old.verified is distinct from new.verified)
  execute function private.audit_lease_verification();

-- --------------------------------------------------------------------------- statements: verification and correction

create function private.stamp_statement_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'verified' and old.status <> 'verified' and (select auth.uid()) is not null then
    new.verified_by_user_id := (select auth.uid());
    new.verified_at := now();
  end if;
  return new;
end;
$$;
create trigger stamp_verification before update of status on public.statements
  for each row when (old.status is distinct from new.status)
  execute function private.stamp_statement_verification();

create function private.audit_statement_change()
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
           else 'figures corrected' end),
    changes
  );
  return null;
end;
$$;
create trigger audit_change after update on public.statements
  for each row execute function private.audit_statement_change();

-- --------------------------------------------------------------------------- extractions: review and field corrections

create function private.stamp_extraction_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'pending_review' and (select auth.uid()) is not null then
    new.reviewed_by_user_id := (select auth.uid());
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger stamp_review before update of status on public.statement_extractions
  for each row when (old.status is distinct from new.status)
  execute function private.stamp_extraction_review();

create function private.audit_extraction_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id,
    case new.status when 'confirmed' then 'verify' when 'rejected' then 'reject' else 'update' end,
    'statement_extraction',
    new.id,
    format('Statement extraction %s', replace(new.status::text, '_', ' ')),
    jsonb_build_array(private.field_change('status', old.status, new.status))
  );
  return null;
end;
$$;
create trigger audit_review after update of status on public.statement_extractions
  for each row when (old.status is distinct from new.status)
  execute function private.audit_extraction_review();

create function private.stamp_field_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.corrected_value is null then
    new.corrected_by_user_id := null;
  elsif (select auth.uid()) is not null then
    new.corrected_by_user_id := (select auth.uid());
  end if;
  return new;
end;
$$;
create trigger stamp_correction before update of corrected_value on public.statement_extraction_fields
  for each row when (old.corrected_value is distinct from new.corrected_value)
  execute function private.stamp_field_correction();

create function private.audit_field_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id,
    'update',
    'statement_extraction',
    new.extraction_id,
    format('Corrected extracted field %s', new.name),
    jsonb_build_array(jsonb_build_object(
      'field', new.name::text,
      'before', coalesce(old.corrected_value, old.value),
      'after', coalesce(new.corrected_value, new.value)
    ))
  );
  return null;
end;
$$;
create trigger audit_correction after update of corrected_value on public.statement_extraction_fields
  for each row when (old.corrected_value is distinct from new.corrected_value)
  execute function private.audit_field_correction();

-- --------------------------------------------------------------------------- monitoring events: resolution and dismissal

create function private.stamp_event_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'dismissed' then
    new.dismissed_by_user_id := coalesce((select auth.uid()), new.dismissed_by_user_id);
    new.dismissed_at := case when (select auth.uid()) is null then coalesce(new.dismissed_at, now()) else now() end;
  else
    new.dismissal_reason := null;
    new.dismissed_by_user_id := null;
    new.dismissed_at := null;
  end if;
  if new.status = 'resolved' then
    new.resolved_by_user_id := coalesce((select auth.uid()), new.resolved_by_user_id);
    new.resolved_at := case when (select auth.uid()) is null then coalesce(new.resolved_at, now()) else now() end;
  end if;
  return new;
end;
$$;
create trigger stamp_status before update of status on public.monitoring_events
  for each row when (old.status is distinct from new.status)
  execute function private.stamp_event_status();

create function private.audit_event_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id,
    case new.status when 'dismissed' then 'dismiss' when 'resolved' then 'resolve' else 'update' end,
    'monitoring_event',
    new.id,
    case new.status
      when 'dismissed' then format('Dismissed monitoring event "%s": %s', new.title, new.dismissal_reason)
      else format('Monitoring event "%s" %s → %s', new.title, old.status, new.status)
    end,
    jsonb_build_array(private.field_change('status', old.status, new.status))
  );
  return null;
end;
$$;
create trigger audit_status after update of status on public.monitoring_events
  for each row when (old.status is distinct from new.status)
  execute function private.audit_event_status();

-- --------------------------------------------------------------------------- message approvals: decisions

create function private.stamp_approval_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.decision = 'pending' then
    new.decided_by_user_id := null;
    new.decided_at := null;
  else
    new.decided_by_user_id := coalesce((select auth.uid()), new.decided_by_user_id);
    new.decided_at := case when (select auth.uid()) is null then coalesce(new.decided_at, now()) else now() end;
  end if;
  return new;
end;
$$;
create trigger stamp_decision before update of decision on public.message_approvals
  for each row when (old.decision is distinct from new.decision)
  execute function private.stamp_approval_decision();

create function private.audit_approval_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id,
    case new.decision when 'approved' then 'approve' when 'rejected' then 'reject' else 'update' end,
    'message_approval',
    new.id,
    format('Message approval %s%s', new.decision, coalesce(': ' || new.reason, '')),
    jsonb_build_array(private.field_change('decision', old.decision, new.decision))
  );
  return null;
end;
$$;
create trigger audit_decision after update of decision on public.message_approvals
  for each row when (old.decision is distinct from new.decision)
  execute function private.audit_approval_decision();
