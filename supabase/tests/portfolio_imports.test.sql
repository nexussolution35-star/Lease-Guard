-- Portfolio import batches (ticket I-01): company scoping, writer-only creation, uploader stamping, audit, storage.
-- Self-contained: fixtures/two_companies.psql creates every row inside this transaction.
-- Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(24);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  -- Batch entries only: the fixture's leases use ids in the same 60000000-… range.
  select * from public.audit_logs where entity_type = 'portfolio_import' and entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.batch(p_id uuid) returns public.portfolio_imports
language sql security definer set search_path = '' as $$
  select * from public.portfolio_imports where id = p_id
$$;
create function tests.row_count(p_id uuid) returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.portfolio_import_rows where import_id = p_id
$$;

create table tests.ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as nexus,
  '20000000-0000-4000-8000-000000000002'::uuid as kgalagadi,
  '30000000-0000-4000-8000-000000000001'::uuid as msq,
  '10000000-0000-4000-8000-000000000003'::uuid as naledi,
  '60000000-0000-4000-8000-000000000001'::uuid as csv_batch,
  '60000000-0000-4000-8000-000000000002'::uuid as xlsx_batch,
  '60000000-0000-4000-8000-000000000003'::uuid as other_batch;
grant select on tests.ids to authenticated, service_role;

-- A call of create_portfolio_import with the fixed parts filled in.
create function tests.create_csv(p_company uuid, p_id uuid, p_rows jsonb, p_uploaded_by uuid default null)
returns public.portfolio_imports language sql set search_path = '' as $$
  select public.create_portfolio_import(
    p_id, p_company, 'properties', null, 'portfolio.csv', p_company::text || '/' || p_id::text || '/portfolio.csv',
    'csv', 120, repeat('a', 64), null, null, ',', array['Property code', 'Property name'], p_rows
  )
$$;
grant execute on function tests.create_csv(uuid, uuid, jsonb, uuid) to authenticated;

-- ------------------------------------------------------------------ a property manager uploads a CSV
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$select tests.create_csv((select nexus from tests.ids), (select csv_batch from tests.ids),
    '[{"rowNumber": 2, "cells": ["MSQ", "Maponya Square"]}, {"rowNumber": 4, "cells": ["KGP", "Kgalagadi Park"]}]')$$,
  'a property manager records a batch with its rows'
);
select is((tests.batch((select csv_batch from tests.ids))).row_count, 2, 'the row count comes from the rows');
select is(tests.row_count((select csv_batch from tests.ids)), 2::bigint, 'the rows are stored against the batch');
select is((tests.batch((select csv_batch from tests.ids))).uploaded_by_user_id, (select naledi from tests.ids), 'the uploader is the signed-in user');
select is((select action::text || ' ' || summary from tests.audit((select csv_batch from tests.ids))),
  'upload Portfolio file portfolio.csv uploaded: 2 rows', 'creating a batch is audited');
select is((select actor_user_id from tests.audit((select csv_batch from tests.ids))), (select naledi from tests.ids), 'by the signed-in user');

select throws_ok(
  $$insert into public.portfolio_imports (id, company_id, scope, file_name, storage_path, file_format, size_bytes, file_sha256,
      delimiter, columns, row_count, uploaded_by_user_id)
    values (gen_random_uuid(), (select nexus from tests.ids), 'properties', 'x.csv', 'x', 'csv', 1, repeat('a', 64), ',', '{A}', 1,
      '10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'the uploader cannot be set by the client'
);
select throws_ok(
  $$select tests.create_csv((select nexus from tests.ids), gen_random_uuid(), '[]')$$,
  '23514', null, 'a batch without rows is refused'
);

-- XLSX: a units import for one property, read from a named sheet.
select lives_ok(
  $$select public.create_portfolio_import(
      (select xlsx_batch from tests.ids), (select nexus from tests.ids), 'units', (select msq from tests.ids), 'units.xlsx',
      (select nexus from tests.ids)::text || '/' || (select xlsx_batch from tests.ids)::text || '/units.xlsx', 'xlsx', 2048, repeat('b', 64),
      'Units', array['Notes', 'Units'], null, array['Unit number'], '[{"rowNumber": 2, "cells": ["Shop 1"]}]')$$,
  'a units batch for a property is recorded'
);
select throws_ok(
  $$select public.create_portfolio_import(
      gen_random_uuid(), (select nexus from tests.ids), 'units', null, 'units.xlsx', 'x', 'xlsx', 2048, repeat('b', 64),
      'Units', array['Units'], null, array['Unit number'], '[{"rowNumber": 2, "cells": ["Shop 1"]}]')$$,
  '23514', null, 'a units batch needs its property'
);
select lives_ok(
  $$select public.replace_portfolio_import_sheet((select nexus from tests.ids), (select xlsx_batch from tests.ids), 'Notes',
      array['Note', 'By'], '[{"rowNumber": 1, "cells": ["a", "b"]}, {"rowNumber": 3, "cells": ["c", "d"]}]')$$,
  'another sheet of the workbook can be read instead'
);
select is((select (b.sheet_name, b.row_count, b.columns)::text from tests.batch((select xlsx_batch from tests.ids)) b), '(Notes,2,"{Note,By}")',
  'with its columns and row count');
select is((select summary from tests.audit((select xlsx_batch from tests.ids)) where action = 'update'),
  'Portfolio file units.xlsx now read from the sheet Notes', 'changing the sheet is audited');
select throws_ok(
  $$select public.replace_portfolio_import_sheet((select nexus from tests.ids), (select xlsx_batch from tests.ids), 'Missing', array['A'], '[{"rowNumber": 1, "cells": ["a"]}]')$$,
  '23514', null, 'only a sheet of the workbook can be chosen'
);
select throws_ok(
  $$delete from public.portfolio_imports where id = (select csv_batch from tests.ids)$$,
  '42501', null, 'a batch is never deleted by a person'
);

-- Units are not imported into an archived property.
reset role;
insert into public.properties (id, company_id, name, code, type, address_line1, suburb, city, province, postal_code,
    gross_lettable_area_sqm, manager_user_id, accounting_system)
values ('30000000-0000-4000-8000-0000000000aa', (select nexus from tests.ids), 'Archived Arcade', 'ARC', 'retail', '1 Road', 'Soweto',
    'Johannesburg', 'Gauteng', '1804', 100, (select naledi from tests.ids), 'MRI');
update public.properties set status = 'archived' where code = 'ARC';
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$select public.create_portfolio_import(
      gen_random_uuid(), (select nexus from tests.ids), 'units', '30000000-0000-4000-8000-0000000000aa', 'units.xlsx', 'x', 'xlsx', 2048, repeat('b', 64),
      'Units', array['Units'], null, array['Unit number'], '[{"rowNumber": 2, "cells": ["Shop 1"]}]')$$,
  'P0001', 'This property is archived. Restore it before importing units into it.', 'no units are imported into an archived property'
);

-- ------------------------------------------------------------------ other roles and companies
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
select is((select count(*) from public.portfolio_imports), 3::bigint, 'read-only members read the batches');
select is((select count(*) from public.portfolio_import_rows), 5::bigint, 'and their rows');
select throws_ok(
  $$select tests.create_csv((select nexus from tests.ids), (select other_batch from tests.ids), '[{"rowNumber": 2, "cells": ["A", "B"]}]')$$,
  '42501', null, 'read-only members cannot create a batch'
);
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select throws_ok(
  $$select tests.create_csv((select nexus from tests.ids), (select other_batch from tests.ids), '[{"rowNumber": 2, "cells": ["A", "B"]}]')$$,
  '42501', null, 'property owners cannot create a batch'
);
select set_config('request.jwt.claims', tests.claims('lerato@kgalagadiproperty.co.za'), true);
select is((select count(*) from public.portfolio_imports where company_id = (select nexus from tests.ids)), 0::bigint, 'another company sees no batches');
select is((select count(*) from public.portfolio_import_rows where company_id = (select nexus from tests.ids)), 0::bigint, 'and no rows');

-- ------------------------------------------------------------------ storage
reset role;
select is((select (public, file_size_limit)::text from storage.buckets where id = 'portfolio-imports'), '(f,5242880)',
  'the original files are kept in a private bucket limited to 5 MB');
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'portfolio_imports_%'),
  2::bigint, 'members read and writers upload; nobody signed in replaces or deletes an original'
);

select * from finish();
rollback;
