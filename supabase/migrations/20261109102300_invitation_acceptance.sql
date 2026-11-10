-- Invitation acceptance by the invitee (replaces the send-time membership design).
--
-- Principle: a company membership is created ONLY when the invitee accepts the invitation while
-- signed in with the invited email. Sending an invitation (worker or platform tooling) never creates
-- or changes a membership, and using the invite link (email confirmation) no longer accepts anything.
--
-- * company_invitations.status gains 'declined'. Revoked, declined and accepted invitations free the
--   (company_id, email) slot for a new invitation (company_invitations_open_email_idx covers only
--   pending and sent). Declining is audited like revoking and accepting.
-- * public.accept_company_invitation / public.decline_company_invitation / public.list_my_company_invitations:
--   the invitee's own operations. They are SECURITY DEFINER because the invitee is not yet a member of
--   the company, so RLS hides both the invitation and the company from them, and because only the
--   function owner may insert company_users. Each one derives the caller from auth.uid() and matches the
--   invitation by the caller's CONFIRMED auth email (auth.users, never the user-editable profile or
--   user metadata). Every failed check raises the same error (42501 'This invitation is not
--   available'), so a caller learns nothing about invitations that are not theirs.
-- * private.handle_auth_user_confirmed only activates an 'invited' profile.

-- --------------------------------------------------------------------------- status 'declined'

alter table public.company_invitations
  drop constraint company_invitations_status_check,
  add constraint company_invitations_status_check
    check (status in ('pending', 'sent', 'accepted', 'revoked', 'declined', 'failed'));

-- Same function as 20261109101900 with a 'declined' branch.
create or replace function private.audit_company_invitation()
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
  elsif new.status = 'declined' then
    perform private.write_audit(
      new.company_id, 'update', 'company', new.company_id,
      format('%s declined the invitation to join as %s', new.email, replace(new.role::text, '_', ' ')),
      jsonb_build_array(private.field_change('invitationStatus', old.status, new.status))
    );
  end if;
  return null;
end;
$$;
revoke all on function private.audit_company_invitation() from public;

drop trigger audit_invitation_status on public.company_invitations;
create trigger audit_invitation_status after update of status on public.company_invitations
  for each row when (old.status is distinct from new.status and new.status in ('revoked', 'accepted', 'declined'))
  execute function private.audit_company_invitation();

-- --------------------------------------------------------------------------- invitee operations

-- Locks and returns the caller's own 'sent' invitation, or raises the generic error. The invitation
-- belongs to the caller when the caller's auth user has a confirmed email equal to the invitation
-- email. The row lock serialises accept/decline with a concurrent revoke or resend: if another
-- transaction changes the status first, the re-checked WHERE no longer matches and the call fails.
create function private.lock_own_sent_invitation(p_invitation_id uuid)
returns public.company_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invitation public.company_invitations;
begin
  if v_user_id is null or p_invitation_id is null then
    raise exception 'This invitation is not available' using errcode = '42501';
  end if;

  select i.* into v_invitation
  from public.company_invitations i
  where i.id = p_invitation_id
    and i.status = 'sent'
    and exists (
      select 1 from auth.users u
      where u.id = v_user_id and u.email_confirmed_at is not null and lower(u.email) = i.email
    )
  for update of i;

  if not found then
    raise exception 'This invitation is not available' using errcode = '42501';
  end if;
  return v_invitation;
end;
$$;
revoke all on function private.lock_own_sent_invitation(uuid) from public;

-- Accepts the caller's own sent invitation and returns its company_id. Creates the membership with the
-- invited role (an existing member keeps their current role), makes it the caller's default workspace
-- when they have none, links and accepts the invitation, and activates an 'invited' profile. A
-- suspended or deactivated profile is refused (never re-activated).
create function public.accept_company_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invitation public.company_invitations;
begin
  v_invitation := private.lock_own_sent_invitation(p_invitation_id);

  -- Locking the caller's profile also serialises concurrent acceptances by the same user, so two
  -- acceptances cannot both choose is_default = true (company_users_one_default_idx).
  perform 1 from public.profiles p
  where p.id = v_user_id and p.status in ('invited', 'active')
  for update of p;
  if not found then
    raise exception 'This invitation is not available' using errcode = '42501';
  end if;

  insert into public.company_users (company_id, user_id, role, is_default)
  values (
    v_invitation.company_id, v_user_id, v_invitation.role,
    not exists (select 1 from public.company_users cu where cu.user_id = v_user_id and cu.is_default)
  )
  on conflict (company_id, user_id) do nothing;

  update public.company_invitations
  set status = 'accepted', accepted_at = now(), invited_user_id = v_user_id
  where id = v_invitation.id;

  update public.profiles set status = 'active' where id = v_user_id and status = 'invited';

  return v_invitation.company_id;
end;
$$;
revoke all on function public.accept_company_invitation(uuid) from public, anon;
grant execute on function public.accept_company_invitation(uuid) to authenticated;
comment on function public.accept_company_invitation(uuid) is
  'Accept the caller''s own sent invitation (matched by confirmed auth email); returns the company id. Raises 42501 "This invitation is not available" otherwise.';

-- Declines the caller's own sent invitation. Declining grants nothing, so only the ownership checks
-- apply (a suspended profile may still decline).
create function public.decline_company_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.company_invitations;
begin
  v_invitation := private.lock_own_sent_invitation(p_invitation_id);
  update public.company_invitations set status = 'declined' where id = v_invitation.id;
end;
$$;
revoke all on function public.decline_company_invitation(uuid) from public, anon;
grant execute on function public.decline_company_invitation(uuid) to authenticated;
comment on function public.decline_company_invitation(uuid) is
  'Decline the caller''s own sent invitation (matched by confirmed auth email). Raises 42501 "This invitation is not available" otherwise.';

-- The caller's open ('sent') invitations, matched by their confirmed auth email. Empty when the caller
-- is not signed in or their email is not confirmed.
create function public.list_my_company_invitations()
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  role public.user_role,
  invited_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.company_id, c.name, i.role, inviter.full_name, i.created_at
  from auth.users u
  join public.company_invitations i on i.email = lower(u.email) and i.status = 'sent'
  join public.companies c on c.id = i.company_id
  left join public.profiles inviter on inviter.id = i.invited_by_user_id
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  order by i.created_at desc, i.id
$$;
revoke all on function public.list_my_company_invitations() from public, anon;
grant execute on function public.list_my_company_invitations() to authenticated;
comment on function public.list_my_company_invitations() is
  'The caller''s own open (sent) invitations, matched by confirmed auth email.';

-- Lookup by email for list_my_company_invitations (the existing indexes lead with company_id).
create index company_invitations_sent_email_idx on public.company_invitations (email) where status = 'sent';

-- --------------------------------------------------------------------------- activation trigger

-- Using the invite link confirms the email: an 'invited' profile becomes 'active'. Invitations and
-- memberships are left alone; the invitee accepts in the app (accept_company_invitation).
create or replace function private.handle_auth_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set status = 'active' where id = new.id and status = 'invited';
  return null;
end;
$$;
revoke all on function private.handle_auth_user_confirmed() from public;
