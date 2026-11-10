-- Colleague profile visibility requires an active caller.
--
-- private.shares_company_with (profiles policy self_or_colleague_read) ignored the caller's profile
-- status, so an invited, suspended or deactivated user could still read every colleague's profile.
-- Like is_company_member and has_company_role, it now only counts the caller while their profile
-- is active. Such users still see their own profile (the policy's id = auth.uid() branch).
-- Colleagues are matched whatever their status, so active members keep seeing invited and
-- suspended colleagues.

create or replace function private.shares_company_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users mine
    join public.profiles me on me.id = mine.user_id
    join public.company_users theirs on theirs.company_id = mine.company_id
    where mine.user_id = (select auth.uid())
      and me.status = 'active'
      and theirs.user_id = p_user_id
  )
$$;

revoke all on function private.shares_company_with(uuid) from public;
grant execute on function private.shares_company_with(uuid) to authenticated, service_role;
