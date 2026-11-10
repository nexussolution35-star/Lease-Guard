-- Invitations to join a company (invite-only onboarding; public sign-up is off).
--
-- Flow: a company_admin creates an invitation through the API (caller JWT, RLS). The worker (service
-- role) sends it with Supabase Auth inviteUserByEmail, upserts the company_users membership, and sets
-- invited_user_id, status 'sent' and sent_at (or 'failed' with failure_reason). When the invitee uses
-- the link, the auth.users activation trigger (20261109102200) marks the invitation 'accepted'.
-- Platform operators create a company's first admin invitation with the service role
-- (invited_by_user_id NULL).
--
-- Signed-in admins may: read their company's invitations, create one ('pending', invited by
-- themselves, nothing else set), and revoke a 'pending' or 'sent' one. Nothing else; no deletes.

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Stored lower-case and trimmed (normalised by trigger before the check runs).
  email text not null,
  -- Shown in the invitation email through the auth user metadata `full_name`.
  full_name text,
  role public.user_role not null,
  status text not null default 'pending',
  -- NULL for invitations created by Nexus platform tooling.
  invited_by_user_id uuid default auth.uid(),
  -- Set by the worker once the auth user exists.
  invited_user_id uuid references public.profiles (id) on delete set null,
  failure_reason text,
  sent_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_invitations_company_id_key unique (company_id, id),
  constraint company_invitations_email_check check (
    email = lower(btrim(email)) and length(email) <= 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint company_invitations_full_name_check check (full_name is null or length(btrim(full_name)) between 1 and 200),
  constraint company_invitations_status_check check (status in ('pending', 'sent', 'accepted', 'revoked', 'failed')),
  constraint company_invitations_revoked_check check (status <> 'revoked' or revoked_at is not null),
  constraint company_invitations_accepted_check check (status <> 'accepted' or accepted_at is not null),
  constraint company_invitations_failed_check check (status <> 'failed' or failure_reason is not null),
  -- The inviter is a member of the company. Removing the inviter's membership keeps the invitation.
  constraint company_invitations_invited_by_fk foreign key (company_id, invited_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (invited_by_user_id)
);
-- One open invitation per email and company.
create unique index company_invitations_open_email_idx on public.company_invitations (company_id, email)
  where status in ('pending', 'sent');
create index company_invitations_company_status_idx on public.company_invitations (company_id, status, created_at desc);
create index company_invitations_invited_by_idx on public.company_invitations (company_id, invited_by_user_id)
  where invited_by_user_id is not null;
create index company_invitations_invited_user_idx on public.company_invitations (invited_user_id)
  where invited_user_id is not null;

create trigger set_updated_at before update on public.company_invitations
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.company_invitations
  for each row execute function private.prevent_company_change();

-- --------------------------------------------------------------------------- guard and stamps

create function private.guard_company_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.email := lower(btrim(new.email));
  elsif new.email is distinct from old.email then
    new.email := lower(btrim(new.email));
  end if;

  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.status <> 'pending' or new.invited_by_user_id is distinct from (select auth.uid())
         or new.invited_user_id is not null or new.sent_at is not null or new.accepted_at is not null
         or new.revoked_at is not null or new.failure_reason is not null then
        raise exception 'an invitation is created pending, by the signed-in admin, with nothing else set'
          using errcode = '42501';
      end if;
    elsif new.status is distinct from old.status
          and not (old.status in ('pending', 'sent') and new.status = 'revoked') then
      raise exception 'a signed-in admin can only revoke a pending or sent invitation (not % -> %)', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'revoked' and (tg_op = 'INSERT' or old.status <> 'revoked') then
    new.revoked_at := now();
  elsif new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
    new.accepted_at := coalesce(new.accepted_at, now());
  end if;
  return new;
end;
$$;
revoke all on function private.guard_company_invitation() from public;

create trigger guard_invitation before insert or update on public.company_invitations
  for each row execute function private.guard_company_invitation();

-- --------------------------------------------------------------------------- audit

create function private.audit_company_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      new.company_id, 'create', 'company', new.company_id,
      format('Invited %s as %s', new.email, replace(new.role::text, '_', ' ')),
      jsonb_build_array(
        private.field_change('invitationId', null::uuid, new.id),
        private.field_change('invitationEmail', null::text, new.email),
        private.field_change('invitationRole', null::text, new.role::text)
      )
    );
  elsif new.status = 'revoked' then
    perform private.write_audit(
      new.company_id, 'update', 'company', new.company_id,
      format('Revoked the invitation for %s', new.email),
      jsonb_build_array(private.field_change('invitationStatus', old.status, new.status))
    );
  elsif new.status = 'accepted' then
    perform private.write_audit(
      new.company_id, 'update', 'user', coalesce(new.invited_user_id, new.id),
      format('%s accepted the invitation to join as %s', new.email, replace(new.role::text, '_', ' ')),
      jsonb_build_array(private.field_change('invitationStatus', old.status, new.status))
    );
  end if;
  return null;
end;
$$;
revoke all on function private.audit_company_invitation() from public;

create trigger audit_invitation_created after insert on public.company_invitations
  for each row execute function private.audit_company_invitation();
create trigger audit_invitation_status after update of status on public.company_invitations
  for each row when (old.status is distinct from new.status and new.status in ('revoked', 'accepted'))
  execute function private.audit_company_invitation();

-- --------------------------------------------------------------------------- privileges and RLS

alter table public.company_invitations enable row level security;
grant all on public.company_invitations to service_role;
grant select on public.company_invitations to authenticated;
grant insert (company_id, email, full_name, role, status, invited_by_user_id) on public.company_invitations to authenticated;
grant update (status) on public.company_invitations to authenticated;

create policy admins_read on public.company_invitations for select to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]));
create policy admins_invite on public.company_invitations for insert to authenticated
  with check (
    company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])
    and status = 'pending'
    and invited_by_user_id = (select auth.uid())
  );
create policy admins_revoke on public.company_invitations for update to authenticated
  using (company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[]))
  with check (
    company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])
    and status = 'revoked'
  );
