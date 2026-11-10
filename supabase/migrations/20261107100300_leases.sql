-- Leases, bank guarantees and lease documents.
--
-- Escalation, renewal option and deposit are columns on leases: each lease has exactly one of each
-- (deposit optional), they are part of the terms verified together, and CHECK constraints can then
-- relate them to each other. The bank guarantee is a 1:1 child table because it has its own
-- lifecycle (status, issue/expiry, release or call), is monitored by expiry date independently of
-- the lease, and is linked to its own supporting document.

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reference text not null,
  property_id uuid not null,
  unit_id uuid not null,
  tenant_id uuid not null,
  commencement_date date not null,
  expiry_date date not null,
  -- Rentals exclude VAT.
  initial_monthly_rental numeric(14, 2) not null check (initial_monthly_rental >= 0),
  current_monthly_rental numeric(14, 2) not null check (current_monthly_rental >= 0),
  payment_due_day smallint not null check (payment_due_day between 1 and 28),

  escalation_type public.escalation_type not null,
  escalation_percentage numeric(7, 3) check (escalation_percentage >= 0),
  escalation_fixed_amount numeric(14, 2) check (escalation_fixed_amount >= 0),
  escalation_cpi_assumed_percentage numeric(7, 3) check (escalation_cpi_assumed_percentage >= 0),
  escalation_cpi_margin_percentage numeric(7, 3),
  escalation_frequency public.escalation_frequency not null,
  first_escalation_date date not null,

  renewal_option_exists boolean not null default false,
  renewal_term_months smallint check (renewal_term_months > 0),
  renewal_notice_period_months smallint check (renewal_notice_period_months >= 0),
  renewal_exercised boolean not null default false,
  renewal_exercised_on date,
  renewal_notes text,

  deposit_amount numeric(14, 2) check (deposit_amount >= 0),
  deposit_basis_months numeric(5, 2) check (deposit_basis_months > 0),
  deposit_held_by public.deposit_holder,
  deposit_received_on date,
  deposit_interest_bearing boolean,
  deposit_notes text,

  status public.lease_status not null default 'draft',
  -- Lease terms must be verified before they drive financial monitoring.
  verified boolean not null default false,
  verified_by_user_id uuid,
  verified_at timestamptz,
  previous_lease_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leases_company_id_key unique (company_id, id),
  constraint leases_company_reference_key unique (company_id, reference),
  constraint leases_dates_check check (expiry_date > commencement_date),
  constraint leases_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id),
  constraint leases_unit_fk foreign key (company_id, property_id, unit_id)
    references public.units (company_id, property_id, id),
  constraint leases_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id),
  constraint leases_previous_fk foreign key (company_id, previous_lease_id)
    references public.leases (company_id, id),
  constraint leases_verified_by_fk foreign key (company_id, verified_by_user_id)
    references public.company_users (company_id, user_id),
  constraint leases_escalation_terms_check check (
    case escalation_type
      when 'percentage' then escalation_percentage is not null
      when 'fixed_amount' then escalation_fixed_amount is not null
      when 'cpi_linked' then escalation_cpi_assumed_percentage is not null
      else true
    end
  ),
  constraint leases_renewal_check check (
    (renewal_option_exists or not renewal_exercised)
    and (renewal_exercised or renewal_exercised_on is null)
  ),
  constraint leases_deposit_complete_check check (
    (deposit_amount is null) = (deposit_held_by is null)
    and (deposit_amount is null) = (deposit_interest_bearing is null)
  ),
  constraint leases_verification_check check (
    verified = (verified_by_user_id is not null and verified_at is not null)
  )
);
create index leases_company_status_idx on public.leases (company_id, status);
create index leases_company_expiry_idx on public.leases (company_id, expiry_date);
create index leases_company_unverified_idx on public.leases (company_id) where not verified;
create index leases_property_idx on public.leases (company_id, property_id);
create index leases_unit_idx on public.leases (company_id, property_id, unit_id);
create index leases_tenant_idx on public.leases (company_id, tenant_id);
create index leases_previous_idx on public.leases (company_id, previous_lease_id) where previous_lease_id is not null;
create index leases_verified_by_idx on public.leases (company_id, verified_by_user_id) where verified_by_user_id is not null;

alter table public.units
  add constraint units_current_tenant_fk foreign key (company_id, current_tenant_id)
    references public.tenants (company_id, id),
  add constraint units_current_lease_fk foreign key (company_id, current_lease_id)
    references public.leases (company_id, id);
create index units_current_tenant_idx on public.units (company_id, current_tenant_id) where current_tenant_id is not null;
create index units_current_lease_idx on public.units (company_id, current_lease_id) where current_lease_id is not null;

create table public.lease_bank_guarantees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  lease_id uuid not null unique,
  bank text not null,
  reference_number text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  -- The guarantee was sized as this many months of rental at issue.
  basis_months numeric(5, 2) not null check (basis_months > 0),
  issued_on date not null,
  expires_on date not null,
  status public.guarantee_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_bank_guarantees_company_id_key unique (company_id, id),
  constraint lease_bank_guarantees_dates_check check (expires_on > issued_on),
  constraint lease_bank_guarantees_lease_fk foreign key (company_id, lease_id)
    references public.leases (company_id, id) on delete cascade
);
create index lease_bank_guarantees_company_expiry_idx on public.lease_bank_guarantees (company_id, expires_on);
create index lease_bank_guarantees_company_status_idx on public.lease_bank_guarantees (company_id, status);

-- Storage objects follow `<company_id>/<entity_id>/<file name>` (see the storage migration).
create table public.lease_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  lease_id uuid not null,
  document_type public.lease_document_type not null,
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by_user_id uuid not null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_documents_company_id_key unique (company_id, id),
  constraint lease_documents_storage_path_check check (storage_path like company_id::text || '/%'),
  constraint lease_documents_lease_fk foreign key (company_id, lease_id)
    references public.leases (company_id, id) on delete cascade,
  constraint lease_documents_uploaded_by_fk foreign key (company_id, uploaded_by_user_id)
    references public.company_users (company_id, user_id)
);
create index lease_documents_lease_idx on public.lease_documents (company_id, lease_id);
create index lease_documents_uploaded_by_idx on public.lease_documents (company_id, uploaded_by_user_id);

create trigger set_updated_at before update on public.leases
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.leases
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.lease_bank_guarantees
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.lease_bank_guarantees
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.lease_documents
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.lease_documents
  for each row execute function private.prevent_company_change();
