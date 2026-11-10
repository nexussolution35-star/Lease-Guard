-- LeaseGuard foundation: private schema, enum types and generic row triggers.
--
-- Enum values mirror the `as const` tuples in packages/domain/src/types exactly, in the same order.
-- supabase/seed.sql (generated from the domain package) asserts this at seed time, so any drift
-- between the domain model and the database fails `supabase db reset`.

-- Helper functions live in `private`, which is not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- --------------------------------------------------------------------------- enums (domain tuples)

create type public.sa_province as enum (
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga',
  'North West', 'Northern Cape', 'Western Cape'
);
create type public.entity_type as enum (
  'company', 'user', 'property', 'unit', 'tenant', 'lease', 'lease_document', 'statement',
  'statement_extraction', 'monitoring_event', 'monitoring_rule', 'payment_arrangement',
  'communication', 'message_template', 'message_approval', 'notification', 'audit_log'
);
create type public.company_status as enum ('active', 'suspended', 'archived');
create type public.whatsapp_connection_status as enum (
  'not_configured', 'pending_verification', 'connected', 'disconnected', 'error'
);
create type public.weekday as enum (
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
);
create type public.user_role as enum ('company_admin', 'property_manager', 'property_owner', 'read_only');
create type public.user_status as enum ('active', 'invited', 'suspended', 'deactivated');
create type public.property_type as enum (
  'shopping_centre', 'retail', 'office', 'industrial_warehouse', 'mixed_use'
);
create type public.property_status as enum ('active', 'under_development', 'archived');
create type public.unit_type as enum (
  'anchor_retail', 'line_shop', 'kiosk', 'restaurant', 'office_suite', 'warehouse', 'yard',
  'storage', 'parking'
);
create type public.occupancy_status as enum ('occupied', 'vacant', 'under_offer', 'unavailable');
create type public.tenant_status as enum ('active', 'in_arrears', 'notice_given', 'vacated', 'prospective');
create type public.business_type as enum (
  'pty_ltd', 'close_corporation', 'sole_proprietor', 'partnership', 'npc', 'franchise'
);
create type public.lease_status as enum (
  'draft', 'pending_verification', 'active', 'expiring', 'expired', 'renewed', 'terminated'
);
create type public.escalation_type as enum ('percentage', 'fixed_amount', 'cpi_linked', 'none');
create type public.escalation_frequency as enum ('annual', 'biennial');
create type public.deposit_holder as enum ('landlord', 'managing_agent', 'attorney_trust');
create type public.guarantee_status as enum ('active', 'expiring', 'expired', 'released', 'called');
create type public.lease_document_type as enum (
  'signed_lease', 'addendum', 'renewal_agreement', 'bank_guarantee', 'deposit_receipt', 'fica', 'other'
);
-- Property.accountingSystem uses the same literal union as StatementSource.
create type public.statement_source as enum ('MRI', 'MDA', 'PropSys', 'Sage', 'other');
create type public.statement_status as enum (
  'uploaded', 'processing', 'review_required', 'verified', 'rejected', 'duplicate'
);
create type public.line_item_category as enum (
  'rental', 'operating_costs', 'rates_and_taxes', 'utilities', 'parking', 'marketing_levy',
  'interest', 'other_charge', 'payment', 'credit'
);
create type public.line_item_kind as enum ('charge', 'payment', 'credit');
create type public.extraction_field_name as enum (
  'tenant_name', 'unit_number', 'statement_date', 'period_start', 'period_end', 'rental_charged',
  'additional_charges', 'payments_received', 'outstanding_balance', 'total_due'
);
create type public.extraction_status as enum ('pending_review', 'confirmed', 'corrected', 'rejected');
create type public.arrangement_status as enum ('proposed', 'active', 'completed', 'defaulted', 'cancelled');
create type public.installment_frequency as enum ('weekly', 'fortnightly', 'monthly');
create type public.installment_status as enum (
  'scheduled', 'reminder_sent', 'confirmed_paid', 'missed', 'waived'
);
create type public.monitoring_event_type as enum (
  'rental_escalation_discrepancy', 'lease_expiry', 'renewal_notice_deadline', 'guarantee_expiry',
  'guarantee_shortfall', 'deposit_shortfall', 'arrears', 'arrangement_attention',
  'statement_review_required'
);
create type public.event_priority as enum ('low', 'medium', 'high', 'critical');
create type public.monitoring_event_status as enum (
  'new', 'under_review', 'action_required', 'in_progress', 'resolved', 'dismissed'
);
create type public.channel as enum ('whatsapp', 'email', 'system');
create type public.message_direction as enum ('outbound', 'inbound');
create type public.recipient_type as enum ('tenant', 'property_owner');
-- MESSAGE_TYPES = TENANT_MESSAGE_TYPES ++ OWNER_MESSAGE_TYPES ++ inbound_reply, manual.
create type public.message_type as enum (
  'monthly_statement', 'initial_payment_reminder', 'overdue_payment_reminder',
  'follow_up_payment_reminder', 'arrangement_installment_reminder',
  'owner_weekly_summary', 'owner_query_response', 'inbound_reply', 'manual'
);
create type public.delivery_status as enum (
  'draft', 'pending_approval', 'approved', 'queued', 'sent', 'delivered', 'read', 'failed',
  'rejected', 'received'
);
create type public.template_approval_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.approval_decision as enum ('pending', 'approved', 'rejected');
create type public.notification_type as enum (
  'monitoring_event', 'statement_review', 'approval_request', 'arrangement', 'message_failed', 'system'
);
create type public.notification_severity as enum ('info', 'warning', 'critical');
create type public.audit_action as enum (
  'create', 'update', 'archive', 'delete', 'verify', 'approve', 'reject', 'upload', 'send',
  'resolve', 'dismiss', 'login', 'logout', 'workspace_switch', 'reset_demo_data'
);

-- The only message types a tenant may ever receive (TENANT_MESSAGE_TYPES). Used by CHECK
-- constraints on communications and message_templates.
create function private.is_tenant_message_type(t public.message_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t in (
    'monthly_statement', 'initial_payment_reminder', 'overdue_payment_reminder',
    'follow_up_payment_reminder', 'arrangement_installment_reminder'
  )
$$;

-- --------------------------------------------------------------------------- generic row triggers

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A record never moves between companies; composite foreign keys rely on company_id being stable.
create function private.prevent_company_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'company_id cannot be changed on %', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
