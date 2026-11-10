-- Companies, user profiles, company memberships and per-company WhatsApp configuration.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  trading_name text,
  registration_number text,
  vat_number text,
  address_line1 text not null,
  address_line2 text,
  suburb text not null,
  city text not null,
  province public.sa_province not null,
  postal_code text not null check (postal_code ~ '^[0-9]{4}$'),
  country text not null default 'South Africa' check (country = 'South Africa'),
  contact_email text not null,
  contact_phone text not null,
  status public.company_status not null default 'active',
  initials text not null check (initials ~ '^[A-Z]{2}$'),
  -- CompanySettings. Typed columns rather than jsonb because database guards read them
  -- (require_approval_for_tenant_messages) and the monitoring engine filters on them.
  lease_expiry_notice_days integer[] not null default '{180,90,30}',
  renewal_deadline_warning_days integer[] not null default '{90,60,30}',
  guarantee_expiry_notice_days integer[] not null default '{90,30}',
  payment_reminder_initial_days integer not null default 3 check (payment_reminder_initial_days >= 0),
  payment_reminder_overdue_days integer not null default 10,
  payment_reminder_follow_up_days integer not null default 20,
  installment_reminder_lead_days integer not null default 3 check (installment_reminder_lead_days >= 0),
  owner_summary_weekday public.weekday not null default 'monday',
  -- Pilot safety switch: tenant messages need an approved message_approval before sending.
  require_approval_for_tenant_messages boolean not null default true,
  timezone text not null default 'Africa/Johannesburg' check (timezone = 'Africa/Johannesburg'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_reminder_offsets_ordered check (
    payment_reminder_initial_days < payment_reminder_overdue_days
    and payment_reminder_overdue_days < payment_reminder_follow_up_days
  ),
  constraint companies_notice_days_positive check (
    0 < all (lease_expiry_notice_days)
    and 0 < all (renewal_deadline_warning_days)
    and 0 < all (guarantee_expiry_notice_days)
  )
);
create index companies_status_idx on public.companies (status);

-- One row per auth user. Global identity data; company access lives in company_users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,
  -- Required for property owners who receive WhatsApp summaries.
  whatsapp_number text check (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  job_title text,
  status public.user_status not null default 'invited',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every auth user gets a profile, so foreign keys to profiles always resolve. Invited users are
-- created through the Auth admin API with `full_name` in user metadata.
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- CompanyMembership: a user can belong to several companies with a role per company.
create table public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.user_role not null,
  -- Workspace opened by default on login.
  is_default boolean not null default false,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of composite foreign keys that require a user to be a member of the row's company.
  constraint company_users_company_user_key unique (company_id, user_id)
);
create index company_users_user_idx on public.company_users (user_id);
create unique index company_users_one_default_idx on public.company_users (user_id) where is_default;

-- Non-secret WhatsApp Business configuration. The access token is held by the backend's secret
-- store; this table only keeps an opaque reference to it.
create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  business_account_id text not null,
  phone_number_id text not null,
  display_name text not null,
  display_number text not null,
  access_token_reference text not null check (access_token_reference ~ '^secret://'),
  webhook_configured boolean not null default false,
  connection_status public.whatsapp_connection_status not null default 'not_configured',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.company_users
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.company_users
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.whatsapp_accounts
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.whatsapp_accounts
  for each row execute function private.prevent_company_change();

-- --------------------------------------------------------------------------- membership helpers
-- SECURITY DEFINER so policies can read company_users without recursing into its own RLS.
-- Only active users count as members: suspending a profile revokes access everywhere.

create function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    join public.profiles p on p.id = cu.user_id
    where cu.company_id = p_company_id
      and cu.user_id = (select auth.uid())
      and p.status = 'active'
  )
$$;

create function private.has_company_role(p_company_id uuid, p_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    join public.profiles p on p.id = cu.user_id
    where cu.company_id = p_company_id
      and cu.user_id = (select auth.uid())
      and p.status = 'active'
      and cu.role = any (p_roles)
  )
$$;

-- company_admin and property_manager maintain company data; property_owner and read_only only read.
create function private.can_write(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_company_role(p_company_id, '{company_admin,property_manager}'::public.user_role[])
$$;

-- True when the caller shares at least one company with p_user_id (profile visibility).
create function private.shares_company_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users mine
    join public.company_users theirs on theirs.company_id = mine.company_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  )
$$;

revoke all on function private.is_company_member(uuid) from public;
revoke all on function private.has_company_role(uuid, public.user_role[]) from public;
revoke all on function private.can_write(uuid) from public;
revoke all on function private.shares_company_with(uuid) from public;
grant execute on function private.is_company_member(uuid) to authenticated, service_role;
grant execute on function private.has_company_role(uuid, public.user_role[]) to authenticated, service_role;
grant execute on function private.can_write(uuid) to authenticated, service_role;
grant execute on function private.shares_company_with(uuid) to authenticated, service_role;
