-- Payment arrangements and their instalments. These are records of an agreement between the tenant
-- and the owner or manager. LeaseGuard never processes or verifies payments: an instalment is
-- confirmed from an updated statement or by the property manager.

create table public.payment_arrangements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tenant_id uuid not null,
  property_id uuid not null,
  unit_id uuid not null,
  lease_id uuid not null,
  -- Outstanding balance at the time of agreement.
  outstanding_balance numeric(14, 2) not null check (outstanding_balance > 0),
  installment_amount numeric(14, 2) not null check (installment_amount > 0),
  frequency public.installment_frequency not null,
  first_installment_date date not null,
  final_installment_date date not null,
  status public.arrangement_status not null default 'proposed',
  -- While active, normal arrears reminders are paused for this tenant.
  suppress_arrears_reminders boolean not null default true,
  agreed_by_user_id uuid not null,
  agreed_on date not null,
  closed_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_arrangements_company_id_key unique (company_id, id),
  constraint payment_arrangements_dates_check check (final_installment_date >= first_installment_date),
  constraint payment_arrangements_closed_check check (
    (status in ('completed', 'defaulted', 'cancelled')) or closed_on is null
  ),
  constraint payment_arrangements_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id),
  constraint payment_arrangements_unit_fk foreign key (company_id, property_id, unit_id)
    references public.units (company_id, property_id, id),
  constraint payment_arrangements_lease_fk foreign key (company_id, lease_id)
    references public.leases (company_id, id),
  constraint payment_arrangements_agreed_by_fk foreign key (company_id, agreed_by_user_id)
    references public.company_users (company_id, user_id)
);
create index payment_arrangements_company_status_idx on public.payment_arrangements (company_id, status);
create index payment_arrangements_tenant_idx on public.payment_arrangements (company_id, tenant_id, status);
create index payment_arrangements_unit_idx on public.payment_arrangements (company_id, property_id, unit_id);
create index payment_arrangements_lease_idx on public.payment_arrangements (company_id, lease_id);
create index payment_arrangements_agreed_by_idx on public.payment_arrangements (company_id, agreed_by_user_id);

create table public.arrangement_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  arrangement_id uuid not null,
  sequence smallint not null check (sequence > 0),
  due_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  status public.installment_status not null default 'scheduled',
  reminder_sent_at timestamptz,
  confirmed_by_user_id uuid,
  confirmed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrangement_installments_arrangement_sequence_key unique (arrangement_id, sequence),
  constraint arrangement_installments_confirmed_check check (
    (status = 'confirmed_paid') = (confirmed_on is not null and confirmed_by_user_id is not null)
  ),
  constraint arrangement_installments_arrangement_fk foreign key (company_id, arrangement_id)
    references public.payment_arrangements (company_id, id) on delete cascade,
  constraint arrangement_installments_confirmed_by_fk foreign key (company_id, confirmed_by_user_id)
    references public.company_users (company_id, user_id)
);
create index arrangement_installments_arrangement_idx on public.arrangement_installments (company_id, arrangement_id);
create index arrangement_installments_company_due_idx on public.arrangement_installments (company_id, status, due_date);
create index arrangement_installments_confirmed_by_idx on public.arrangement_installments (company_id, confirmed_by_user_id) where confirmed_by_user_id is not null;

create trigger set_updated_at before update on public.payment_arrangements
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.payment_arrangements
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.arrangement_installments
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.arrangement_installments
  for each row execute function private.prevent_company_change();
