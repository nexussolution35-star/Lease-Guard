-- Tenant management rules (PRD module 4, M4-01): column grants, no hard delete, a changed WhatsApp
-- number is unvalidated, audit. Self-contained: fixtures/two_companies.psql creates every row inside
-- this transaction. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
\ir fixtures/two_companies.psql
select plan(27);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.claims(p_email text) returns text
language sql security definer set search_path = '' as $$
  select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
  from auth.users where email = p_email
$$;
-- Audit rows and tenants read as the database owner (independent of the caller's RLS).
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
  (select id from auth.users where email = 'naledi.vdmerwe@nexussolution.co.za') as naledi;
grant select on tests.ids to authenticated, service_role;
select ok((select num_nulls(nexus, kgalagadi, naledi) = 0 from tests.ids), 'every fixture exists');

-- ------------------------------------------------------------------ a property manager creates a tenant
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
set local role authenticated;

select lives_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, contact_full_name, contact_role,
      contact_phone, whatsapp_number, email, industry)
    values ((select nexus from tests.ids), 'Soweto Shoes (Pty) Ltd', 'Soweto Shoes', 'pty_ltd', 'Sizwe Mabena', 'Owner',
      '+27825550199', '+27825550199', 'accounts@sowetoshoes.co.za', 'Retail')$$,
  'a property manager creates a tenant'
);
select is((tests.tenant('Soweto Shoes')).whatsapp_verified, false, 'a new tenant''s number starts unvalidated');
select is((tests.tenant('Soweto Shoes')).status::text, 'prospective', 'and the tenant starts prospective');
select is((select action::text || ' ' || summary from tests.audit((tests.tenant('Soweto Shoes')).id)), 'create Tenant Soweto Shoes created',
  'creating a tenant is audited');
select is((select actor_user_id from tests.audit((tests.tenant('Soweto Shoes')).id)), (select naledi from tests.ids), 'by the signed-in user');

select throws_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, contact_full_name, contact_role,
      contact_phone, whatsapp_number, whatsapp_verified, industry)
    values ((select nexus from tests.ids), 'Self Validated CC', 'Self Validated', 'close_corporation', 'X', 'Owner',
      '+27825550198', '+27825550198', true, 'Retail')$$,
  '42501', null, 'a signed-in user cannot create a tenant with a validated number'
);
select throws_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, contact_full_name, contact_role,
      contact_phone, whatsapp_number, industry)
    values ((select nexus from tests.ids), 'Bad Number CC', 'Bad Number', 'close_corporation', 'X', 'Owner',
      '082 555 0198', '082 555 0198', 'Retail')$$,
  '23514', null, 'the number must be stored in E.164'
);

-- ------------------------------------------------------------------ edits
update public.tenants set email = 'finance@sowetoshoes.co.za', notes = 'Prefers WhatsApp' where trading_name = 'Soweto Shoes';
select is((select summary from tests.audit((tests.tenant('Soweto Shoes')).id) where action = 'update'), 'Tenant Soweto Shoes updated',
  'an edit is audited');
select is((select jsonb_agg(c ->> 'field' order by c ->> 'field') from tests.audit((tests.tenant('Soweto Shoes')).id) a, jsonb_array_elements(a.changes) c
  where a.action = 'update'), '["email", "notes"]'::jsonb, 'with only the changed fields');
update public.tenants set notes = 'Prefers WhatsApp' where trading_name = 'Soweto Shoes';
select is((select count(*) from tests.audit((tests.tenant('Soweto Shoes')).id) where action = 'update'), 1::bigint,
  'an edit that changes nothing is not audited');

-- ------------------------------------------------------------------ changing a validated number
-- Dlamini Cellular's number is validated in the fixture.
select is((tests.tenant('Dlamini Cellular')).whatsapp_verified, true, 'the fixture tenant''s number is validated');
update public.tenants set whatsapp_number = '+27825550111' where trading_name = 'Dlamini Cellular';
select is((tests.tenant('Dlamini Cellular')).whatsapp_verified, false, 'changing the number resets its validation');
select is((select summary from tests.audit((tests.tenant('Dlamini Cellular')).id) where action = 'update'),
  'Tenant Dlamini Cellular: WhatsApp number changed; it must be validated again', 'the number change is audited');
select is((select changes from tests.audit((tests.tenant('Dlamini Cellular')).id) where action = 'update'),
  '[{"field": "whatsapp_number", "before": "+27821110001", "after": "+27825550111"}, {"field": "whatsapp_verified", "before": true, "after": false}]'::jsonb,
  'with the old and new number and the validation reset');
update public.tenants set contact_full_name = 'Bongani S. Dlamini' where trading_name = 'Dlamini Cellular';
select is((tests.tenant('Dlamini Cellular')).whatsapp_verified, false, 'other edits leave validation as it is');

select throws_ok($$update public.tenants set whatsapp_verified = true where trading_name = 'Dlamini Cellular'$$,
  '42501', null, 'a signed-in user cannot mark a number validated directly');
select throws_ok($$update public.tenants set whatsapp_opted_out = false where trading_name = 'Dlamini Cellular'$$,
  '42501', null, 'nor change the opt-out');
select throws_ok($$update public.tenants set company_id = (select kgalagadi from tests.ids) where trading_name = 'Dlamini Cellular'$$,
  '42501', null, 'the company is fixed');

-- ------------------------------------------------------------------ no hard delete
select throws_ok($$delete from public.tenants where trading_name = 'Soweto Shoes'$$, '42501', null, 'a writer cannot delete a tenant');

-- ------------------------------------------------------------------ roles that only read
select set_config('request.jwt.claims', tests.claims('kabelo.molefe@nexussolution.co.za'), true);
update public.tenants set notes = 'Changed by read only' where trading_name = 'Soweto Shoes';
select is((tests.tenant('Soweto Shoes')).notes, 'Prefers WhatsApp', 'a read-only member changes nothing');
select throws_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, contact_full_name, contact_role,
      contact_phone, whatsapp_number, industry)
    values ((select nexus from tests.ids), 'Read Only CC', 'Read Only', 'close_corporation', 'X', 'Owner', '+27825550197', '+27825550197', 'Retail')$$,
  '42501', null, 'a read-only member cannot create a tenant'
);
select set_config('request.jwt.claims', tests.claims('pieter@bothafamilytrust.co.za'), true);
update public.tenants set notes = 'Changed by owner' where trading_name = 'Soweto Shoes';
select is((tests.tenant('Soweto Shoes')).notes, 'Prefers WhatsApp', 'a property owner changes nothing');

-- ------------------------------------------------------------------ the other company
select set_config('request.jwt.claims', tests.claims('naledi.vdmerwe@nexussolution.co.za'), true);
update public.tenants set whatsapp_number = '+27825550112' where trading_name = 'Arcadia Books';
select is((tests.tenant('Arcadia Books')).whatsapp_number, '+27821110004', 'a writer of one company cannot change another company''s tenant');
select throws_ok(
  $$insert into public.tenants (company_id, legal_name, trading_name, business_type, contact_full_name, contact_role,
      contact_phone, whatsapp_number, industry)
    values ((select kgalagadi from tests.ids), 'Probe CC', 'Probe', 'close_corporation', 'X', 'Owner', '+27825550196', '+27825550196', 'Retail')$$,
  '42501', null, 'nor create a tenant there'
);

-- ------------------------------------------------------------------ background jobs (no signed-in user)
reset role;
select set_config('request.jwt.claims', '', true);
update public.tenants set whatsapp_number = '+27825550113' where trading_name = 'Arcadia Books';
select is((tests.tenant('Arcadia Books')).whatsapp_verified, false, 'a number changed by a background job is unvalidated too');
-- Fresh Mart's number is unvalidated in the fixture.
update public.tenants set whatsapp_number = '+27825550114', whatsapp_verified = true where trading_name = 'Fresh Mart';
select is((tests.tenant('Fresh Mart')).whatsapp_verified, true,
  'the service role can record a new number it has already validated in the same write');

select * from finish();
rollback;
