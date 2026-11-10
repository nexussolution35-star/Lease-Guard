-- An admin who corrects a number's WhatsApp Business Account id does not leave an empty account behind.
--
-- 20261110100400 records the account a number names (record_business_account trigger). When a company
-- admin then changes that number's business_account_id (e.g. fixing a mistyped id through
-- PUT /companies/:id/whatsapp with the number's LeaseGuard id), the old account would stay with no
-- numbers, and signed-in users cannot delete accounts. This trigger removes the old account of the
-- same company when an admin's edit leaves it with no numbers.
--
-- Only edits made by signed-in users clean up: the service role (Embedded Signup, verification) manages
-- accounts explicitly and may hold an account before any of its numbers. Inside this SECURITY DEFINER
-- function current_user is the owner, so the caller's role is read from the `role` setting, which
-- PostgREST sets per request and SECURITY DEFINER does not change.

create function private.remove_emptied_whatsapp_business_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated'
     and (new.company_id, new.business_account_id) is distinct from (old.company_id, old.business_account_id) then
    delete from public.whatsapp_business_accounts a
    where a.company_id = old.company_id
      and a.business_account_id = old.business_account_id
      and not exists (
        select 1 from public.whatsapp_phone_numbers n
        where n.company_id = old.company_id and n.business_account_id = old.business_account_id
      );
  end if;
  return null;
end;
$$;
revoke all on function private.remove_emptied_whatsapp_business_account() from public;

create trigger remove_emptied_business_account after update of company_id, business_account_id
  on public.whatsapp_phone_numbers
  for each row execute function private.remove_emptied_whatsapp_business_account();
