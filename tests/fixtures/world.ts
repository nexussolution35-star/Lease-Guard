import { randomBytes, randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { localSql } from './local-db.ts'
import { assertLocal, type LocalSupabase } from './local-supabase.ts'

/**
 * A "world": everything one test run needs, created at runtime on the LOCAL stack with the service role
 * and deleted again afterwards. Nothing depends on seeded rows; the database may be completely empty.
 *
 * What `createWorld` creates (names are fixed, ids, emails and company names are unique per run):
 *
 * Users (Auth admin API, email confirmed, random password, profile `active` with phone, WhatsApp
 * number and job title):
 * - `admin`    company_admin of company A only
 * - `manager`  property_manager of A (default workspace) and of B
 * - `readOnly` read_only member of A
 * - `owner`    property_owner of A (owner of A's properties)
 *
 * Company A: 4 properties (codes ACP, BOT, CRV, DIP; types shopping_centre, office, retail,
 * industrial_warehouse), 7 units, 4 WhatsApp-verified active tenants, 7 leases (references
 * ACP-001..DIP-001; ACP-001, ACP-002 and BOT-001 verified/active, BOT-002 pending_verification, the
 * rest draft) and 2 monitoring events in status `new`.
 * Company B: 1 property (ECR, retail), 1 unit, 1 tenant, 1 draft lease.
 */

export type WorldCompanyKey = 'a' | 'b'
export type WorldUserKey = 'admin' | 'manager' | 'readOnly' | 'owner'
export type WorldRole = 'company_admin' | 'property_manager' | 'property_owner' | 'read_only'

export interface WorldUser {
  key: WorldUserKey
  id: string
  email: string
  /** Random per run; LOCAL stack only. */
  password: string
  fullName: string
  phone: string
  whatsappNumber: string
  jobTitle: string
  roles: Partial<Record<WorldCompanyKey, WorldRole>>
  defaultCompany: WorldCompanyKey
}

export interface WorldProperty {
  id: string
  code: string
  name: string
  type: 'shopping_centre' | 'retail' | 'office' | 'industrial_warehouse' | 'mixed_use'
}

export interface WorldUnit {
  id: string
  propertyId: string
  unitNumber: string
}

export interface WorldTenant {
  id: string
  legalName: string
  tradingName: string
  whatsappNumber: string
}

export interface WorldLease {
  id: string
  reference: string
  propertyId: string
  unitId: string
  tenantId: string
  status: 'draft' | 'pending_verification' | 'active'
  verified: boolean
}

export interface WorldMonitoringEvent {
  id: string
  title: string
  propertyId: string
}

export interface WorldCompany {
  key: WorldCompanyKey
  id: string
  name: string
  tradingName: string
  initials: string
  properties: WorldProperty[]
  units: WorldUnit[]
  tenants: WorldTenant[]
  leases: WorldLease[]
  monitoringEvents: WorldMonitoringEvent[]
}

export interface World {
  runId: string
  companies: Record<WorldCompanyKey, WorldCompany>
  users: Record<WorldUserKey, WorldUser>
}

export interface CreateWorldOptions {
  /** Unique per run; defaults to a timestamp + random suffix. Used in emails and company names. */
  runId?: string
  /** Prefix for emails and company names, e.g. 'it' or 'e2e' (lowercase letters/digits). */
  label?: string
}

/** What cleanup removed, and what audit_logs (append-only) forced it to keep in a disabled state. */
export interface WorldCleanupReport {
  storageObjectsRemoved: number
  companiesDeleted: number
  /** Companies referenced by audit_logs (ON DELETE RESTRICT): emptied, memberships removed, status archived. */
  companiesArchived: number
  usersDeleted: number
  /** Users referenced as audit_logs actors: Auth user soft-deleted (cannot sign in), profile deactivated. */
  usersDeactivated: number
}

const STORAGE_BUCKETS = ['statements', 'lease-documents', 'agent-knowledge'] as const

function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
}

export function serviceRoleClient(supabase: LocalSupabase): SupabaseClient {
  assertLocal('SUPABASE_URL', supabase.url)
  return createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what} failed: ${error?.message ?? 'no data returned'}`)
}

type Row = Record<string, unknown>

async function insertRows(db: SupabaseClient, table: string, rows: Row[]): Promise<string[]> {
  const { data, error } = await db.from(table).insert(rows).select('id').overrideTypes<{ id: string }[], { merge: false }>()
  if (error || !data || data.length !== rows.length) fail(`Insert into ${table}`, error)
  return data.map((row) => row.id)
}

const USER_SPECS: Readonly<
  Record<WorldUserKey, { fullName: string; jobTitle: string; phone: string; whatsapp: string; roles: Partial<Record<WorldCompanyKey, WorldRole>>; defaultCompany: WorldCompanyKey }>
> = {
  admin: { fullName: 'Ayanda Admin', jobTitle: 'Portfolio Director', phone: '+27 11 555 0101', whatsapp: '+27820000101', roles: { a: 'company_admin' }, defaultCompany: 'a' },
  manager: {
    fullName: 'Mpho Manager',
    jobTitle: 'Property Manager',
    phone: '+27 11 555 0102',
    whatsapp: '+27820000102',
    roles: { a: 'property_manager', b: 'property_manager' },
    defaultCompany: 'a',
  },
  readOnly: { fullName: 'Rethabile Reader', jobTitle: 'Analyst', phone: '+27 11 555 0103', whatsapp: '+27820000103', roles: { a: 'read_only' }, defaultCompany: 'a' },
  owner: { fullName: 'Olwethu Owner', jobTitle: 'Owner', phone: '+27 11 555 0104', whatsapp: '+27820000104', roles: { a: 'property_owner' }, defaultCompany: 'a' },
}

const PROPERTY_SPECS: Readonly<Record<WorldCompanyKey, readonly Omit<WorldProperty, 'id'>[]>> = {
  a: [
    { code: 'ACP', name: 'Acacia Park Shopping Centre', type: 'shopping_centre' },
    { code: 'BOT', name: 'Baobab Office Tower', type: 'office' },
    { code: 'CRV', name: 'Cypress Retail Village', type: 'retail' },
    { code: 'DIP', name: 'Disa Industrial Park', type: 'industrial_warehouse' },
  ],
  b: [{ code: 'ECR', name: 'Erica Corner Retail Centre', type: 'retail' }],
}

/** Lease specs per company: property code, unit number, tenant index, status. */
const LEASE_SPECS: Readonly<Record<WorldCompanyKey, readonly { code: string; unit: string; tenant: number; status: WorldLease['status'] }[]>> = {
  a: [
    { code: 'ACP', unit: '001', tenant: 0, status: 'active' },
    { code: 'ACP', unit: '002', tenant: 1, status: 'active' },
    { code: 'BOT', unit: '001', tenant: 2, status: 'active' },
    { code: 'BOT', unit: '002', tenant: 3, status: 'pending_verification' },
    { code: 'CRV', unit: '001', tenant: 0, status: 'draft' },
    { code: 'CRV', unit: '002', tenant: 1, status: 'draft' },
    { code: 'DIP', unit: '001', tenant: 2, status: 'draft' },
  ],
  b: [{ code: 'ECR', unit: '001', tenant: 0, status: 'draft' }],
}

const TENANT_NAMES: Readonly<Record<WorldCompanyKey, readonly string[]>> = {
  a: ['Umoya Coffee', 'Ilanga Pharmacy', 'Khanya Optometrists', 'Thabo Hardware'],
  b: ['Lerato Books'],
}

/**
 * Creates the world on the LOCAL stack. On failure, everything created so far is removed before the
 * error is rethrown.
 */
export async function createWorld(supabase: LocalSupabase, options: CreateWorldOptions = {}): Promise<World> {
  const runId = options.runId ?? newRunId()
  const label = options.label ?? 'test'
  if (!/^[a-z0-9]+$/.test(label)) throw new Error(`World label must be lowercase letters/digits: ${label}`)
  const db = serviceRoleClient(supabase)

  const partial: World = {
    runId,
    companies: {} as Record<WorldCompanyKey, WorldCompany>,
    users: {} as Record<WorldUserKey, WorldUser>,
  }
  try {
    await populate(db, partial, label)
    return partial
  } catch (error) {
    await destroyWorld(supabase, partial).catch((cleanupError: unknown) => {
      console.error('[world] cleanup after a failed createWorld also failed:', cleanupError)
    })
    throw error
  }
}

async function populate(db: SupabaseClient, world: World, label: string): Promise<void> {
  const { runId } = world

  // Companies.
  for (const key of ['a', 'b'] as const) {
    const letter = key.toUpperCase()
    const tradingName = `${label.toUpperCase()} ${letter} Properties ${runId}`
    const initials = key === 'a' ? 'TA' : 'TB'
    const [id] = await insertRows(db, 'companies', [
      {
        name: `${tradingName} (Pty) Ltd`,
        trading_name: tradingName,
        address_line1: `${key === 'a' ? 10 : 20} Test Street`,
        suburb: 'Rosebank',
        city: 'Johannesburg',
        province: 'Gauteng',
        postal_code: '2196',
        contact_email: `office.${key}.${runId}@leaseguard.test`,
        contact_phone: '+27 11 555 0100',
        initials,
      },
    ])
    world.companies[key] = {
      key,
      id: id!,
      name: `${tradingName} (Pty) Ltd`,
      tradingName,
      initials,
      properties: [],
      units: [],
      tenants: [],
      leases: [],
      monitoringEvents: [],
    }
  }

  // Users: Auth admin API; the on_auth_user_created trigger creates the profile, completed here.
  for (const key of Object.keys(USER_SPECS) as WorldUserKey[]) {
    const spec = USER_SPECS[key]
    const email = `${label}-${key.toLowerCase()}.${runId}@leaseguard.test`
    const password = `${randomBytes(18).toString('base64url')}Aa1!`
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName },
    })
    if (error || !data.user) fail(`Create auth user ${email}`, error)
    world.users[key] = {
      key,
      id: data.user.id,
      email,
      password,
      fullName: spec.fullName,
      phone: spec.phone,
      whatsappNumber: spec.whatsapp,
      jobTitle: spec.jobTitle,
      roles: spec.roles,
      defaultCompany: spec.defaultCompany,
    }
    const profile = await db
      .from('profiles')
      .update({ full_name: spec.fullName, phone: spec.phone, whatsapp_number: spec.whatsapp, job_title: spec.jobTitle, status: 'active' })
      .eq('id', data.user.id)
      .select('id')
    if (profile.error || profile.data?.length !== 1) fail(`Complete profile ${email}`, profile.error)

    const memberships = Object.entries(spec.roles).map(([company, role]) => ({
      company_id: world.companies[company as WorldCompanyKey].id,
      user_id: data.user.id,
      role,
      is_default: company === spec.defaultCompany,
    }))
    await insertRows(db, 'company_users', memberships)
  }

  const manager = world.users.manager
  const owner = world.users.owner
  const admin = world.users.admin

  for (const key of ['a', 'b'] as const) {
    const company = world.companies[key]

    const specs = PROPERTY_SPECS[key]
    const propertyIds = await insertRows(
      db,
      'properties',
      specs.map((p, index) => ({
        company_id: company.id,
        name: p.name,
        code: p.code,
        type: p.type,
        address_line1: `${index + 1} Test Avenue`,
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        postal_code: '2196',
        gross_lettable_area_sqm: 1000 * (index + 1),
        manager_user_id: manager.id,
        owner_user_id: key === 'a' ? owner.id : null,
        accounting_system: 'MRI',
      })),
    )
    company.properties = specs.map((p, index) => ({ ...p, id: propertyIds[index]! }))
    const propertyByCode = new Map(company.properties.map((p) => [p.code, p]))

    const unitSpecs = LEASE_SPECS[key].map((l) => ({ code: l.code, unit: l.unit }))
    const unitIds = await insertRows(
      db,
      'units',
      unitSpecs.map((u) => ({
        company_id: company.id,
        property_id: propertyByCode.get(u.code)!.id,
        unit_number: `${u.code}-${u.unit}`,
        type: 'line_shop',
        floor_area_sqm: 120,
        occupancy_status: 'occupied',
      })),
    )
    company.units = unitSpecs.map((u, index) => ({ id: unitIds[index]!, propertyId: propertyByCode.get(u.code)!.id, unitNumber: `${u.code}-${u.unit}` }))

    const names = TENANT_NAMES[key]
    const tenantRows = names.map((name, index) => ({
      legalName: `${name} (Pty) Ltd`,
      tradingName: name,
      whatsappNumber: `+2783${key === 'a' ? 1 : 2}00000${index}`,
    }))
    const tenantIds = await insertRows(
      db,
      'tenants',
      tenantRows.map((t) => ({
        company_id: company.id,
        legal_name: t.legalName,
        trading_name: t.tradingName,
        business_type: 'pty_ltd',
        contact_full_name: `${t.tradingName} Contact`,
        contact_role: 'Director',
        contact_phone: '+27 11 555 0200',
        whatsapp_number: t.whatsappNumber,
        whatsapp_verified: true,
        whatsapp_opted_out: false,
        status: 'active',
        industry: 'Retail',
      })),
    )
    company.tenants = tenantRows.map((t, index) => ({ ...t, id: tenantIds[index]! }))

    const leaseSpecs = LEASE_SPECS[key]
    const verifiedAt = new Date().toISOString()
    const leaseRows = leaseSpecs.map((l, index) => {
      const property = propertyByCode.get(l.code)!
      const unit = company.units[index]!
      const tenant = company.tenants[l.tenant]!
      const verified = l.status === 'active'
      return {
        lease: { reference: `${l.code}-${l.unit}`, propertyId: property.id, unitId: unit.id, tenantId: tenant.id, status: l.status, verified },
        row: {
          company_id: company.id,
          reference: `${l.code}-${l.unit}`,
          property_id: property.id,
          unit_id: unit.id,
          tenant_id: tenant.id,
          // Distinct expiry dates so date sorting is meaningful.
          commencement_date: `202${index % 5}-03-01`,
          expiry_date: `203${index % 10}-02-28`,
          initial_monthly_rental: 20_000 + index * 1_500,
          current_monthly_rental: 21_600 + index * 1_620,
          payment_due_day: 1,
          escalation_type: 'percentage',
          escalation_percentage: 8,
          escalation_frequency: 'annual',
          first_escalation_date: `202${(index % 5) + 1}-03-01`,
          status: l.status,
          verified,
          verified_by_user_id: verified ? (key === 'a' ? admin.id : manager.id) : null,
          verified_at: verified ? verifiedAt : null,
        },
      }
    })
    const leaseIds = await insertRows(db, 'leases', leaseRows.map((l) => l.row))
    company.leases = leaseRows.map((l, index) => ({ ...l.lease, id: leaseIds[index]! }))

    if (key === 'a') {
      const eventSpecs = [
        { title: 'Lease ACP-001 expires within 180 days', property: company.properties[0]! },
        { title: 'Lease BOT-001 renewal notice deadline approaching', property: company.properties[1]! },
      ]
      const eventIds = await insertRows(
        db,
        'monitoring_events',
        eventSpecs.map((e, index) => ({
          company_id: company.id,
          type: index === 0 ? 'lease_expiry' : 'renewal_notice_deadline',
          property_id: e.property.id,
          title: e.title,
          description: `${e.title} (created by the test run ${runId}).`,
          identified_on: `2026-11-0${index + 1}`,
          priority: 'medium',
          recommended_action: 'Review the lease terms and contact the tenant if needed.',
          status: 'new',
        })),
      )
      company.monitoringEvents = eventSpecs.map((e, index) => ({ id: eventIds[index]!, title: e.title, propertyId: e.property.id }))
    }
  }
}

function uuidList(ids: readonly string[]): string {
  for (const id of ids) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error(`Not a uuid: ${id}`)
  }
  return `array[${ids.map((id) => `'${id}'`).join(', ')}]::uuid[]`
}

async function count(sql: string): Promise<number> {
  const rows = await localSql(sql)
  const first = rows[0]
  if (typeof first !== 'object' || first === null || !('n' in first)) throw new Error(`Unexpected count result for: ${sql}`)
  return Number(first.n)
}

async function removeStorageObjects(db: SupabaseClient, companyIds: readonly string[]): Promise<number> {
  let removed = 0
  for (const bucket of STORAGE_BUCKETS) {
    for (const companyId of companyIds) {
      const folders = await db.storage.from(bucket).list(companyId, { limit: 1000 })
      if (folders.error) fail(`List ${bucket}/${companyId}`, folders.error)
      for (const folder of folders.data) {
        const prefix = `${companyId}/${folder.name}`
        const files = await db.storage.from(bucket).list(prefix, { limit: 1000 })
        if (files.error) fail(`List ${bucket}/${prefix}`, files.error)
        const paths = files.data.map((file) => `${prefix}/${file.name}`)
        if (paths.length === 0) continue
        const result = await db.storage.from(bucket).remove(paths)
        if (result.error) fail(`Remove objects under ${bucket}/${prefix}`, result.error)
        removed += paths.length
      }
    }
  }
  return removed
}

/**
 * Deletes everything the world created (and anything the tests created inside its companies): storage
 * objects, every company-scoped row, memberships, companies and Auth users; then asserts nothing is left.
 *
 * audit_logs is append-only and references companies (ON DELETE RESTRICT) and actor profiles, so a
 * company or user that appears in an audit entry cannot be deleted: such a company is emptied and
 * archived, such a user is soft-deleted in Auth (cannot sign in) and its profile deactivated. Audit
 * entries themselves are never touched.
 */
export async function destroyWorld(supabase: LocalSupabase, world: World): Promise<WorldCleanupReport> {
  return destroyRecords(supabase, recordsOf(world))
}

/**
 * Companies and Auth users a test created itself, outside the world (e.g. through the operator's
 * `platform:create-company` script); removed and checked exactly like the world's.
 */
export interface CreatedRecords {
  /** Names the records in error messages. */
  label: string
  companyIds: readonly string[]
  userIds: readonly string[]
}

function recordsOf(world: World): CreatedRecords {
  return {
    label: `World ${world.runId}`,
    companyIds: Object.values(world.companies ?? {}).map((c) => c.id),
    userIds: Object.values(world.users ?? {}).map((u) => u.id),
  }
}

/** What destroyWorld does, for any companies and users: see destroyWorld. */
export async function destroyRecords(supabase: LocalSupabase, records: CreatedRecords): Promise<WorldCleanupReport> {
  const db = serviceRoleClient(supabase)
  const { companyIds, userIds } = records
  const report: WorldCleanupReport = { storageObjectsRemoved: 0, companiesDeleted: 0, companiesArchived: 0, usersDeleted: 0, usersDeactivated: 0 }

  if (companyIds.length > 0) {
    report.storageObjectsRemoved = await removeStorageObjects(db, companyIds)
    const ids = uuidList(companyIds)
    // Generic, FK-order independent: every public table with a company_id (except audit_logs) is
    // emptied for these companies, retrying tables whose rows are still referenced.
    await localSql(`do $cleanup$
declare
  ids uuid[] := ${ids};
  pending text[];
  failed text[];
  t text;
  pass int := 0;
begin
  update public.units set current_lease_id = null, current_tenant_id = null
    where company_id = any(ids) and (current_lease_id is not null or current_tenant_id is not null);
  update public.leases set previous_lease_id = null where company_id = any(ids) and previous_lease_id is not null;
  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}') into pending
    from information_schema.columns c
    join information_schema.tables tt on tt.table_schema = c.table_schema and tt.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'company_id' and tt.table_type = 'BASE TABLE'
     and c.table_name not in ('companies', 'company_users', 'audit_logs');
  loop
    failed := '{}';
    foreach t in array pending loop
      begin
        execute format('delete from public.%I where company_id = any($1)', t) using ids;
      exception when foreign_key_violation then
        failed := failed || t;
      end;
    end loop;
    exit when cardinality(failed) = 0;
    pass := pass + 1;
    if pass > 25 then raise exception 'world cleanup is stuck on %', failed; end if;
    pending := failed;
  end loop;
  delete from public.company_users where company_id = any(ids);
  foreach t in array array(select unnest(ids)::text) loop
    begin
      delete from public.companies where id = t::uuid;
    exception when foreign_key_violation then
      update public.companies set status = 'archived' where id = t::uuid;
    end;
  end loop;
end $cleanup$`)
    report.companiesArchived = await count(`select count(*)::int as n from public.companies where id = any(${ids})`)
    report.companiesDeleted = companyIds.length - report.companiesArchived
  }

  for (const userId of userIds) {
    const hard = await db.auth.admin.deleteUser(userId)
    if (!hard.error) {
      report.usersDeleted += 1
      continue
    }
    // Referenced by an audit entry (actor): keep the profile row, make the account unusable.
    const memberships = await db.from('company_users').delete().eq('user_id', userId)
    if (memberships.error) fail(`Delete memberships of ${userId}`, memberships.error)
    const profile = await db.from('profiles').update({ status: 'deactivated' }).eq('id', userId)
    if (profile.error) fail(`Deactivate profile ${userId}`, profile.error)
    const soft = await db.auth.admin.deleteUser(userId, true)
    if (soft.error) fail(`Delete auth user ${userId} (hard: ${hard.error.message}; soft)`, soft.error)
    report.usersDeactivated += 1
  }

  await assertRecordsGone(records)
  return report
}

/** Throws unless nothing of the world remains except audit entries and audit-pinned shells. */
export async function assertWorldGone(world: World): Promise<void> {
  await assertRecordsGone(recordsOf(world))
}

async function assertRecordsGone(records: CreatedRecords): Promise<void> {
  const { companyIds, userIds } = records
  const problems: string[] = []

  if (companyIds.length > 0) {
    const ids = uuidList(companyIds)
    const rows = await localSql(`select c.table_name::text as t
        from information_schema.columns c
        join information_schema.tables tt on tt.table_schema = c.table_schema and tt.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name = 'company_id' and tt.table_type = 'BASE TABLE'
         and c.table_name not in ('companies', 'audit_logs')`)
    for (const row of rows) {
      const table = typeof row === 'object' && row !== null && 't' in row ? String(row.t) : ''
      if (!/^[a-z_]+$/.test(table)) throw new Error(`Unexpected table name ${table}`)
      const n = await count(`select count(*)::int as n from public.${table} where company_id = any(${ids})`)
      if (n > 0) problems.push(`${n} row(s) left in public.${table}`)
    }
    const live = await count(`select count(*)::int as n from public.companies where id = any(${ids}) and status <> 'archived'`)
    if (live > 0) problems.push(`${live} company row(s) left that are not archived`)
    const objects = await count(
      `select count(*)::int as n from storage.objects where bucket_id in (${STORAGE_BUCKETS.map((b) => `'${b}'`).join(', ')}) and split_part(name, '/', 1) = any(${uuidList(companyIds).replace('::uuid[]', '::text[]')})`,
    )
    if (objects > 0) problems.push(`${objects} storage object(s) left`)
  }
  if (userIds.length > 0) {
    const ids = uuidList(userIds)
    const active = await count(`select count(*)::int as n from public.profiles where id = any(${ids}) and status <> 'deactivated'`)
    if (active > 0) problems.push(`${active} profile(s) left that are not deactivated`)
    const authUsers = await count(`select count(*)::int as n from auth.users where id = any(${ids}) and deleted_at is null`)
    if (authUsers > 0) problems.push(`${authUsers} auth user(s) left`)
    const memberships = await count(`select count(*)::int as n from public.company_users where user_id = any(${ids})`)
    if (memberships > 0) problems.push(`${memberships} membership(s) left`)
  }
  if (problems.length > 0) throw new Error(`${records.label} was not cleaned up: ${problems.join('; ')}`)
}

/** A fresh random UUID, for tests that need an id that exists nowhere. */
export function unknownId(): string {
  return randomUUID()
}
