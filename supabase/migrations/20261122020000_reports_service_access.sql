-- The reports service's database access (ADR 0003, ticket R-00).
--
-- The reports service (services/reports) is the first service extracted from the core. Supabase Postgres stays the one
-- system of record, so the service does not get a database of its own. Instead:
--
--   * It connects as the signed-in caller: the public anon key plus the caller's own access token, through the shared
--     service kit (packages/service-kit, RlsClientFactory). It never holds the service-role key, so Row Level Security
--     decides what every query may see, exactly as for the core API.
--   * It reads company data only through read-only reporting functions named public.reports_* (or views of the same
--     name): STABLE, SECURITY INVOKER, executable by `authenticated` only. Each one starts with
--     private.reports_require_member(company), so another company's id is refused (42501) rather than answered with
--     empty figures that look like an answer.
--   * The tables it owns are named reports_* and come from its own migrations (files named *_reports_*.sql). It writes
--     only those, and no other service writes them.
--
-- supabase/tests/reports_service_access.test.sql checks these conventions for every reports_* object, so a later
-- reports migration that breaks one fails the database tests.

create function private.reports_require_member(p_company_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or p_company_id is null or not (p_company_id = any (private.member_company_ids())) then
    raise exception 'Only members of the company can read its reports' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.reports_require_member(uuid) from public, anon;
grant execute on function private.reports_require_member(uuid) to authenticated;
comment on function private.reports_require_member(uuid) is
  'The first statement of every reporting function the reports service calls (public.reports_*): refuses (42501) a '
  'caller who is not signed in or not an active member of the company.';
