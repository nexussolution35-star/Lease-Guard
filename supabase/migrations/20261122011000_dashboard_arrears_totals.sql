-- The dashboard's arrears figures in one query (module 7 acceptance).
--
-- The dashboard used to run the Statements page's arrears summary on every load: it paged through every verified
-- statement of the company (with the tenant, property and unit names) and built an entry per account, only to keep two
-- totals. public.dashboard_arrears_totals(company) returns just those figures, worked out in the database with the
-- rules of the domain `ageArrears` / `arrearsOverview` (@leaseguard/domain rules/arrears.ts, rules/arrearsOverview.ts):
--
--   * only VERIFIED statements with a tenant and a statement date count;
--   * an account is the tenant's unit (the lease when the statement names no unit), and only the account's LATEST
--     verified statement counts (by statement date; on the same date the lowest id, as the summary keeps the first);
--   * the outstanding amount is the closing balance, else the total due, else zero, rounded to cents; an account whose
--     latest balance is zero or in credit is not in arrears;
--   * total_outstanding adds up every account in arrears; tenants_in_arrears counts distinct tenants among them;
--   * an active payment arrangement is per tenant and never takes a balance out of either figure (the balance is still
--     owed; the arrangement only pauses the tenant's normal reminders), so the arrangements are not read here;
--   * pending_review counts statements waiting for review (status review_required).
--
-- The Statements page's summary (GET /statements/arrears) is unchanged. Security invoker: Row Level Security applies to
-- what it reads. It refuses (42501) anyone who is not an active member of the company, so another company's id never
-- returns zeros that look like an answer. A monitoring figure, never a transaction.

create function public.dashboard_arrears_totals(p_company_id uuid)
returns table (total_outstanding numeric, tenants_in_arrears bigint, pending_review bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (p_company_id = any (private.member_company_ids())) then
    raise exception 'Only members of the company can read its dashboard' using errcode = '42501';
  end if;

  return query
  with latest as (
    select distinct on (s.tenant_id, coalesce('unit:' || s.unit_id::text, 'lease:' || coalesce(s.lease_id::text, '')))
      s.tenant_id,
      round(coalesce(s.closing_balance, s.total_due, 0), 2) as outstanding
    from public.statements s
    where s.company_id = p_company_id
      and s.status = 'verified'
      and s.tenant_id is not null
      and s.statement_date is not null
    order by s.tenant_id, coalesce('unit:' || s.unit_id::text, 'lease:' || coalesce(s.lease_id::text, '')), s.statement_date desc, s.id
  )
  select
    coalesce(sum(l.outstanding) filter (where l.outstanding > 0), 0)::numeric,
    count(distinct l.tenant_id) filter (where l.outstanding > 0),
    (select count(*) from public.statements r where r.company_id = p_company_id and r.status = 'review_required')
  from latest l;
end;
$$;
revoke all on function public.dashboard_arrears_totals(uuid) from public, anon;
grant execute on function public.dashboard_arrears_totals(uuid) to authenticated;
comment on function public.dashboard_arrears_totals(uuid) is
  'The dashboard''s arrears figures of a company: the outstanding balance on the latest verified statement of each '
  'tenant''s unit (the lease without a unit), totalled, the distinct tenants with a balance, and the statements waiting '
  'for review. The same rules as the Statements arrears summary (domain ageArrears). Members only (42501 otherwise).';
