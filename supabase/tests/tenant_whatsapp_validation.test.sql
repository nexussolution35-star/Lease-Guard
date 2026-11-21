-- Validating a tenant's WhatsApp number (PRD §5.4, M4-03): only writers, only the number on record,
-- stamped with who and when, cleared when the number changes, audited. Self-contained:
-- fixtures/two_companies.psql creates every row inside this transaction. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(19);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
create function tests.audit(p_entity_id uuid) returns setof public.audit_logs
language sql security definer set search_path = '' as $$
  select * from public.audit_logs where entity_id = p_entity_id order by occurred_at, id
$$;
create function tests.tenant(p_trading_name text) returns public.tenants
language sql security definer set search_path = '' as $$
  select * from public.tenants where trading_name = p_trading_name
$$;

create table tests.ids as select
  (select id from public.companies where initials = 'NS') as nexus,
  (select id from public.companies where initials = 'KP') as kgalagadi,
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi,
  (select id from public.tenants where trading_name = 'Fresh Mart') as fresh_mart,
  (select id from public.tenants where trading_name = 'Arcadia Books') as arcadia;
grant select on tests.ids to authenticated, service_role;
select ok((select num_nulls(nexus, kgalagadi, naledi, fresh_mart, arcadia) = 0 from tests.ids), 'every fixture exists');

-- ------------------------------------------------------------------ members who only read
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
set local role authenticated;
select throws_ok(
  $$select public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select fresh_mart from tests.ids), '+27821110003')$$,
  '42501', null, 'a read-only member cannot validate a number'
);
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
select throws_ok(
  $$select public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select fresh_mart from tests.ids), '+27821110003')$$,
  '42501', null, 'nor a property owner'
);

-- ------------------------------------------------------------------ a property manager validates
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
select is(
  (select outcome from public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select fresh_mart from tests.ids), '+27821110004')),
  'number_changed', 'a number other than the one on record is not validated'
);
select is((tests.tenant('Fresh Mart')).whatsapp_verified, false, 'so the tenant stays unvalidated');
select is(
  (select outcome from public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select fresh_mart from tests.ids), '+27821110003')),
  'validated', 'a property manager validates the number on record'
);
select is((tests.tenant('Fresh Mart')).whatsapp_verified, true, 'the number is validated');
select is((tests.tenant('Fresh Mart')).whatsapp_validated_by_user_id, (select naledi from tests.ids), 'by the signed-in user');
select ok((tests.tenant('Fresh Mart')).whatsapp_validated_at is not null, 'with the time');
select is((select action::text || ' ' || summary from tests.audit((select fresh_mart from tests.ids)) where action = 'verify'),
  'verify Tenant Fresh Mart: WhatsApp number +27821110003 validated', 'the validation is audited');
select is((select actor_user_id from tests.audit((select fresh_mart from tests.ids)) where action = 'verify'), (select naledi from tests.ids),
  'with the signed-in user as actor');
select is(
  (select outcome from public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select fresh_mart from tests.ids), '+27821110003')),
  'already_validated', 'validating again changes nothing'
);
select is((select count(*) from tests.audit((select fresh_mart from tests.ids)) where action = 'verify'), 1::bigint, 'and is not audited again');

-- ------------------------------------------------------------------ the sign-off is not writable directly
select throws_ok($$update public.tenants set whatsapp_validated_at = now() where trading_name = 'Fresh Mart'$$,
  '42501', null, 'a signed-in user cannot write the validation time');

-- ------------------------------------------------------------------ a changed number clears the sign-off
update public.tenants set whatsapp_number = '+27825550120' where trading_name = 'Fresh Mart';
select is((tests.tenant('Fresh Mart')).whatsapp_verified, false, 'changing the number resets the validation');
select ok((tests.tenant('Fresh Mart')).whatsapp_validated_at is null and (tests.tenant('Fresh Mart')).whatsapp_validated_by_user_id is null,
  'and clears who validated it and when');

-- ------------------------------------------------------------------ the other company
select is(
  (select outcome from public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select arcadia from tests.ids), '+27821110004')),
  'not_found', 'another company''s tenant is not found through the own company'
);
select throws_ok(
  $$select public.validate_tenant_whatsapp_number((select kgalagadi from tests.ids), (select arcadia from tests.ids), '+27821110004')$$,
  '42501', null, 'and a writer cannot validate in a company they do not write'
);

-- ------------------------------------------------------------------ anonymous callers
reset role;
set local role anon;
select throws_ok(
  $$select public.validate_tenant_whatsapp_number((select nexus from tests.ids), (select fresh_mart from tests.ids), '+27825550120')$$,
  '42501', null, 'anonymous callers cannot run it'
);

select * from finish();
rollback;
