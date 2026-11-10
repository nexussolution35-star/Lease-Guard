-- Message templates, communications and message approvals.
--
-- Tenants may only receive the five TENANT_MESSAGE_TYPES (statement and payment related). During
-- the pilot every outbound tenant message needs an approved message_approval before it is
-- approved, queued or sent. Both rules are enforced here as the last line of defence; the
-- application checks them first through @leaseguard/domain.

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  message_type public.message_type not null,
  audience public.recipient_type not null,
  -- Template name registered with Meta.
  meta_template_name text not null,
  language text not null check (language in ('en', 'en_ZA', 'af')),
  category text not null check (category in ('utility', 'marketing')),
  -- Body with numbered placeholders {{1}}, {{2}}, ...
  body text not null,
  -- Human names for each placeholder, in order.
  variables text[] not null default '{}',
  approval_status public.template_approval_status not null default 'draft',
  supports_document_attachment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_company_id_key unique (company_id, id),
  constraint message_templates_meta_name_key unique (company_id, meta_template_name, language),
  constraint message_templates_tenant_type_check check (
    audience <> 'tenant' or private.is_tenant_message_type(message_type)
  )
);
create index message_templates_company_type_idx on public.message_templates (company_id, message_type);

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel public.channel not null,
  direction public.message_direction not null,
  message_type public.message_type not null,
  recipient_type public.recipient_type not null,
  tenant_id uuid,
  -- Property owner user, for owner messages.
  owner_user_id uuid,
  property_id uuid,
  lease_id uuid,
  statement_id uuid,
  arrangement_id uuid,
  template_id uuid,
  -- Counterparty number (tenant or owner) and the company's own WhatsApp Business number.
  counterparty_number text not null,
  company_number text not null,
  body text not null,
  attachment_file_name text,
  attachment_storage_path text,
  attachment_mime_type text check (attachment_mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  attachment_size_bytes bigint check (attachment_size_bytes > 0),
  attachment_sha256 text check (attachment_sha256 ~ '^[0-9a-f]{64}$'),
  status public.delivery_status not null default 'draft',
  external_message_id text unique,
  created_by_user_id uuid,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_company_id_key unique (company_id, id),
  -- Tenants never receive escalation, expiry, renewal, dispute or guarantee messages.
  constraint communications_tenant_message_type_check check (
    recipient_type <> 'tenant' or direction = 'inbound' or private.is_tenant_message_type(message_type)
  ),
  constraint communications_inbound_check check (
    (direction = 'inbound') = (message_type = 'inbound_reply')
    and (direction = 'inbound') = (status = 'received')
  ),
  constraint communications_recipient_check check (
    case recipient_type
      when 'tenant' then tenant_id is not null and owner_user_id is null
      when 'property_owner' then owner_user_id is not null and tenant_id is null
    end
  ),
  constraint communications_attachment_check check (
    (attachment_storage_path is null) = (attachment_file_name is null)
    and (attachment_storage_path is null) = (attachment_mime_type is null)
    and (attachment_storage_path is null or attachment_storage_path like company_id::text || '/%')
  ),
  constraint communications_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id),
  constraint communications_owner_fk foreign key (company_id, owner_user_id)
    references public.company_users (company_id, user_id),
  constraint communications_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id),
  constraint communications_lease_fk foreign key (company_id, lease_id)
    references public.leases (company_id, id),
  constraint communications_statement_fk foreign key (company_id, statement_id)
    references public.statements (company_id, id),
  constraint communications_arrangement_fk foreign key (company_id, arrangement_id)
    references public.payment_arrangements (company_id, id),
  constraint communications_template_fk foreign key (company_id, template_id)
    references public.message_templates (company_id, id),
  constraint communications_created_by_fk foreign key (company_id, created_by_user_id)
    references public.company_users (company_id, user_id)
);
create index communications_company_status_idx on public.communications (company_id, status);
create index communications_company_created_idx on public.communications (company_id, created_at desc);
create index communications_tenant_idx on public.communications (company_id, tenant_id, created_at desc) where tenant_id is not null;
create index communications_owner_idx on public.communications (company_id, owner_user_id) where owner_user_id is not null;
create index communications_property_idx on public.communications (company_id, property_id) where property_id is not null;
create index communications_lease_idx on public.communications (company_id, lease_id) where lease_id is not null;
create index communications_statement_idx on public.communications (company_id, statement_id) where statement_id is not null;
create index communications_arrangement_idx on public.communications (company_id, arrangement_id) where arrangement_id is not null;
create index communications_template_idx on public.communications (company_id, template_id) where template_id is not null;
create index communications_created_by_idx on public.communications (company_id, created_by_user_id) where created_by_user_id is not null;

alter table public.statements
  add constraint statements_delivered_communication_fk foreign key (company_id, delivered_communication_id)
    references public.communications (company_id, id);
create index statements_delivered_communication_idx on public.statements (company_id, delivered_communication_id)
  where delivered_communication_id is not null;

create table public.message_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  communication_id uuid not null,
  requested_by_user_id uuid not null,
  requested_at timestamptz not null default now(),
  decision public.approval_decision not null default 'pending',
  decided_by_user_id uuid,
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_approvals_company_id_key unique (company_id, id),
  constraint message_approvals_decision_check check (
    (decision = 'pending') = (decided_by_user_id is null and decided_at is null)
  ),
  constraint message_approvals_communication_fk foreign key (company_id, communication_id)
    references public.communications (company_id, id) on delete cascade,
  constraint message_approvals_requested_by_fk foreign key (company_id, requested_by_user_id)
    references public.company_users (company_id, user_id),
  constraint message_approvals_decided_by_fk foreign key (company_id, decided_by_user_id)
    references public.company_users (company_id, user_id)
);
-- At most one open approval request per message.
create unique index message_approvals_one_pending_idx on public.message_approvals (communication_id)
  where decision = 'pending';
create index message_approvals_communication_idx on public.message_approvals (company_id, communication_id);
create index message_approvals_company_decision_idx on public.message_approvals (company_id, decision);
create index message_approvals_requested_by_idx on public.message_approvals (company_id, requested_by_user_id);
create index message_approvals_decided_by_idx on public.message_approvals (company_id, decided_by_user_id) where decided_by_user_id is not null;

-- Approval guard. A deferred constraint trigger, so a message and its approval can be written in
-- one transaction in either order; the check runs at commit against the committed state.
create function private.guard_tenant_message_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.communications%rowtype;
begin
  select * into msg from public.communications where id = new.id;
  if not found then
    return null;
  end if;
  if msg.direction = 'outbound'
     and msg.recipient_type = 'tenant'
     and msg.status in ('approved', 'queued', 'sent', 'delivered', 'read')
     and (select c.require_approval_for_tenant_messages from public.companies c where c.id = msg.company_id)
     and not exists (
       select 1 from public.message_approvals a
       where a.company_id = msg.company_id and a.communication_id = msg.id and a.decision = 'approved'
     ) then
    raise exception 'tenant message % cannot be % without an approved message approval', msg.id, msg.status
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create constraint trigger tenant_message_requires_approval
  after insert or update of status on public.communications
  deferrable initially deferred
  for each row execute function private.guard_tenant_message_approval();

create trigger set_updated_at before update on public.message_templates
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.message_templates
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.communications
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.communications
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.message_approvals
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.message_approvals
  for each row execute function private.prevent_company_change();
