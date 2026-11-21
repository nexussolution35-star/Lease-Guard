-- Integrity fixes of 21 Nov 2026: a lease is active or expiring only once verified, and portfolio import rows are
-- removed only by re-reading another worksheet (never deleted directly by a signed-in user).
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(9);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.row_count(p_id uuid) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.portfolio_import_rows where import_id = p_id
$$;
create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '60000000-0000-4000-8000-000000000001'::uuid as verified_lease,
  '60000000-0000-4000-8000-000000000002'::uuid as unverified_lease,
  '6a000000-0000-4000-8000-000000000001'::uuid as batch;
grant select on tests.ids to authenticated, service_role;

-- ------------------------------------------------------------------ leases
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select throws_ok(
  $$update public.leases set status = 'active' where id = (select unverified_lease from tests.ids)$$,
  '23514', null, 'an unverified lease cannot be made active'
);
select throws_ok(
  $$update public.leases set status = 'expiring' where id = (select unverified_lease from tests.ids)$$,
  '23514', null, 'nor expiring'
);
select lives_ok(
  $$update public.leases set status = 'expiring' where id = (select verified_lease from tests.ids)$$,
  'a verified lease can be expiring'
);

-- ------------------------------------------------------------------ portfolio import rows
select lives_ok(
  $$select public.create_portfolio_import(
      (select batch from tests.ids), (select nexus from tests.ids), 'properties', null, 'portfolio.xlsx',
      (select nexus from tests.ids)::text || '/' || (select batch from tests.ids)::text || '/portfolio.xlsx',
      'xlsx', 2048, repeat('c', 64), 'Properties', array['Properties', 'Notes'], null, array['Property code'],
      '[{"rowNumber": 2, "cells": ["MSQ"]}, {"rowNumber": 3, "cells": ["KGP"]}]')$$,
  'a property manager records a batch'
);
select throws_ok(
  $$delete from public.portfolio_import_rows where import_id = (select batch from tests.ids)$$,
  '42501', null, 'a property manager cannot delete the batch''s rows directly'
);
select is(tests.row_count((select batch from tests.ids)), 2::bigint, 'the rows are still there');
select lives_ok(
  $$select public.replace_portfolio_import_sheet((select nexus from tests.ids), (select batch from tests.ids), 'Notes',
      array['Note'], '[{"rowNumber": 1, "cells": ["a"]}]')$$,
  'reading another worksheet still replaces the rows'
);
select is(tests.row_count((select batch from tests.ids)), 1::bigint, 'with the new worksheet''s rows');

select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select throws_ok(
  $$select public.replace_portfolio_import_sheet((select nexus from tests.ids), (select batch from tests.ids), 'Properties',
      array['Property code'], '[]')$$,
  '42501', null, 'a read-only member cannot replace the rows'
);

select * from finish();
rollback;
