-- Dedupe keys are written by background jobs only.
--
-- Company writers (company_admin, property_manager) may insert and update monitoring_events through
-- the Data API, so without this guard a signed-in user could set a dedupe key and pre-empt the
-- worker's finding: the worker inserts with ON CONFLICT DO NOTHING and would silently skip it.
-- Notifications grant authenticated users no insert and only update (read, read_at), but the same
-- guard is applied for defence in depth.
--
-- The worker uses the service role, which this guard does not restrict. Events and notifications
-- created by people keep a NULL key, exactly as before.

create function private.guard_dedupe_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (
    (tg_op = 'INSERT' and new.dedupe_key is not null)
    or (tg_op = 'UPDATE' and new.dedupe_key is distinct from old.dedupe_key)
  ) then
    raise exception 'dedupe_key is maintained by background jobs only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_dedupe_key() from public;

create trigger guard_dedupe_key before insert or update of dedupe_key on public.monitoring_events
  for each row execute function private.guard_dedupe_key();
create trigger guard_dedupe_key before insert or update of dedupe_key on public.notifications
  for each row execute function private.guard_dedupe_key();
