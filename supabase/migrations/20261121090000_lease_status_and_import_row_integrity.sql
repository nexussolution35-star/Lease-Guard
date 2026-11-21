-- Two integrity fixes found by the acceptance checks of the portfolio build (21 Nov 2026).
--
--   * A lease is only active or expiring once its terms are verified. `status` stays writable for verification
--     (POST /leases/{id}/verify sets verified and status together), so a writer calling the Data API directly could
--     set an unverified lease to active. Monitoring already ignores unverified leases; this makes the status honest.
--   * Rows of a portfolio import are never deleted by a person. Re-reading another worksheet replaces them inside
--     replace_portfolio_import_sheet, which now runs with its owner's rights after checking the caller is a
--     company admin or property manager of the company, so the DELETE grant and policy for signed-in users go.
--     The batch's change of worksheet is still audited by its trigger.

-- --------------------------------------------------------------------------- leases: live status needs verification

alter table public.leases
  add constraint leases_live_status_verified_check
  check (status not in ('active', 'expiring') or verified);

comment on constraint leases_live_status_verified_check on public.leases is
  'A lease is active or expiring only once its terms are verified (PRD: lease terms are verified before they drive monitoring).';

-- --------------------------------------------------------------------------- portfolio import rows: no direct deletes

drop policy writers_delete on public.portfolio_import_rows;
revoke delete on public.portfolio_import_rows from authenticated;

create or replace function public.replace_portfolio_import_sheet(
  p_company_id uuid,
  p_import_id uuid,
  p_sheet_name text,
  p_columns text[],
  p_rows jsonb
)
returns public.portfolio_imports
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_import public.portfolio_imports;
begin
  -- Owner's rights skip RLS, so the caller's role is checked here (service_role is trusted, as for every table).
  if (select auth.role()) is distinct from 'service_role'
     and not (p_company_id = any ((select private.company_ids_with_role('{company_admin,property_manager}'))::uuid[])) then
    raise exception 'Only company admins and property managers can change a portfolio import' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  update public.portfolio_imports
  set sheet_name = p_sheet_name, columns = p_columns, row_count = jsonb_array_length(p_rows)
  where company_id = p_company_id and id = p_import_id
  returning * into v_import;
  if v_import.id is null then
    raise exception 'Portfolio import not found' using errcode = 'P0002';
  end if;

  delete from public.portfolio_import_rows where company_id = p_company_id and import_id = p_import_id;
  insert into public.portfolio_import_rows (company_id, import_id, row_number, cells)
  select p_company_id, p_import_id, (r.value ->> 'rowNumber')::integer, r.value -> 'cells'
  from jsonb_array_elements(p_rows) as r (value);

  return v_import;
end;
$$;
revoke all on function public.replace_portfolio_import_sheet(uuid, uuid, text, text[], jsonb) from public, anon;
grant execute on function public.replace_portfolio_import_sheet(uuid, uuid, text, text[], jsonb) to authenticated, service_role;
comment on function public.replace_portfolio_import_sheet(uuid, uuid, text, text[], jsonb) is
  'Company admins and property managers. Re-reads a portfolio import from another worksheet: columns, row count and rows are replaced. The only way rows are removed.';
