-- Activation when an invited user first uses their invitation link.
--
-- Supabase Auth confirms the email (email_confirmed_at goes from NULL to a time) when the invite link
-- is verified. Then the profile moves from 'invited' to 'active' and that user's 'sent' invitations
-- become 'accepted'. A suspended or deactivated profile is never re-activated here, and its
-- invitations are left as they are.
--
-- SECURITY DEFINER: Supabase Auth updates auth.users as supabase_auth_admin, which has no rights on
-- public tables.

create function private.handle_auth_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set status = 'active' where id = new.id and status = 'invited';
  update public.company_invitations
  set status = 'accepted', accepted_at = now()
  where invited_user_id = new.id
    and status = 'sent'
    and exists (select 1 from public.profiles p where p.id = new.id and p.status = 'active');
  return null;
end;
$$;
revoke all on function private.handle_auth_user_confirmed() from public;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_auth_user_confirmed();
