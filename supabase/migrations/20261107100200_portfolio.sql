-- Properties, units and tenants.
--
-- Cross-company integrity: every company-owned table has UNIQUE (company_id, id), and children
-- reference parents through composite foreign keys (company_id, parent_id). A row can therefore
-- only point at a parent in its own company. Declarative constraints were chosen over triggers:
-- Postgres enforces them for every role (including service_role and bulk loads), they cannot be
-- disabled per session by application code, and the planner already needs the indexes.
-- Users referenced by business rows must be members of the same company: the composite key
-- (company_id, user_id) references company_users.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  -- Short code used in lease references, e.g. MSQ.
  code text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  type public.property_type not null,
  address_line1 text not null,
  address_line2 text,
  suburb text not null,
  city text not null,
  province public.sa_province not null,
  postal_code text not null check (postal_code ~ '^[0-9]{4}$'),
  country text not null default 'South Africa' check (country = 'South Africa'),
  description text not null default '',
  status public.property_status not null default 'active',
  gross_lettable_area_sqm numeric(12, 2) not null check (gross_lettable_area_sqm > 0),
  manager_user_id uuid not null,
  owner_user_id uuid,
  accounting_system public.statement_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_company_id_key unique (company_id, id),
  constraint properties_company_code_key unique (company_id, code),
  constraint properties_manager_fk foreign key (company_id, manager_user_id)
    references public.company_users (company_id, user_id),
  constraint properties_owner_fk foreign key (company_id, owner_user_id)
    references public.company_users (company_id, user_id)
);
create index properties_company_status_idx on public.properties (company_id, status);
create index properties_manager_idx on public.properties (company_id, manager_user_id);
create index properties_owner_idx on public.properties (company_id, owner_user_id) where owner_user_id is not null;

create table public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  property_id uuid not null,
  unit_number text not null,
  type public.unit_type not null,
  floor_area_sqm numeric(12, 2) not null check (floor_area_sqm > 0),
  floor text,
  occupancy_status public.occupancy_status not null default 'vacant',
  -- Denormalised for table rendering; must agree with the active lease (FKs added with leases).
  current_tenant_id uuid,
  current_lease_id uuid,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_company_id_key unique (company_id, id),
  -- Lets leases, statements and arrangements prove their unit belongs to their property.
  constraint units_company_property_id_key unique (company_id, property_id, id),
  constraint units_property_number_key unique (property_id, unit_number),
  constraint units_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id) on delete cascade
);
create index units_company_occupancy_idx on public.units (company_id, occupancy_status);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  legal_name text not null,
  trading_name text not null,
  business_type public.business_type not null,
  registration_number text,
  vat_number text,
  contact_full_name text not null,
  contact_role text not null,
  contact_phone text not null,
  contact_email text,
  -- E.164 without spaces, used for WhatsApp.
  whatsapp_number text not null check (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  -- Numbers must be validated before automated communication is enabled.
  whatsapp_verified boolean not null default false,
  whatsapp_opted_out boolean not null default false,
  email text,
  status public.tenant_status not null default 'prospective',
  industry text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_company_id_key unique (company_id, id)
);
create index tenants_company_status_idx on public.tenants (company_id, status);
create index tenants_company_whatsapp_idx on public.tenants (company_id, whatsapp_number);

create trigger set_updated_at before update on public.properties
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.properties
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.units
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.units
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.tenants
  for each row execute function private.prevent_company_change();
