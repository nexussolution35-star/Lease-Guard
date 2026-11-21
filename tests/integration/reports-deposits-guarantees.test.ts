import { randomInt } from 'node:crypto'
import path from 'node:path'

import { unwrap } from '@leaseguard/api-client'
import { addDaysISO, type ISODate } from '@leaseguard/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadWorkerEnv } from '../../backend/src/config/env.ts'
import { ServiceRoleClientFactory } from '../../backend/src/infrastructure/database/service-role-client.factory.ts'
import type { ProcessorRuntime } from '../../backend/src/workers/jobs/processor-runtime.ts'
import { LeaseMonitoringProcessor } from '../../backend/src/workers/monitoring/lease-monitoring.processor.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { apiErrorOf, check, expectOk, gatewayAs, integration, serviceRole, world } from './support/clients.ts'
import { logWorkerToFile, workerEnvironment } from './support/in-process-worker.ts'

/**
 * Deposits and guarantees (ticket R-04) on the local stack, through the gateway like the web app. Four leases are added
 * to the world's property CRV in company A with the service role, dated from today (the report is always as at today):
 *
 * - `short`: R35 000 a month at 8% a year, escalated 30 days ago, so R37 800 is expected; its R105 000 guarantee was
 *   sized as three months of the original rental (R113 400 now required, R8 400 short) and its R70 000 deposit as two
 *   months (R75 600 required, R5 600 short): PRD §5.7 D.
 * - `expiring`: a fully covering guarantee that expires in 10 days.
 * - `expired`: a guarantee whose date passed 5 days ago.
 * - `unverified`: terms pending verification, with a guarantee: never listed, counted as excluded.
 *
 * The report's required cover, shortfalls and expiry states are those of the events the worker's real lease monitoring
 * scan raises for the same leases on the same day (built in this process from the backend source, service role, no
 * queue consumed; log `test-results/integration/worker-reports-deposits-guarantees.log`), for every member role, never
 * across companies.
 */

const SCENARIOS = ['short', 'expiring', 'expired', 'unverified'] as const
type Scenario = (typeof SCENARIOS)[number]

interface Party {
  unitId: string
  tenantId: string
  leaseId: string
  reference: string
}

const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
const today: ISODate = SA_DATE.format(new Date())

const companyId = () => world().companies.a.id
const property = () => {
  const found = world().companies.a.properties.find((candidate) => candidate.code === 'CRV')
  if (!found) throw new Error('The world has no property CRV in company A')
  return found
}

let parties: Record<Scenario, Party>
let leases: LeaseMonitoringProcessor
let restoreLogger: (() => void) | undefined

const reportOf = (company: 'a' | 'b' = 'a', user: 'admin' | 'manager' | 'readOnly' | 'owner' = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/deposits_guarantees', { params: { query } }))

const flat = { initial_monthly_rental: 20_000, current_monthly_rental: 20_000, escalation_type: 'none', escalation_percentage: null }
const LEASE_TERMS: Record<Scenario, Record<string, unknown>> = {
  short: {
    initial_monthly_rental: 35_000,
    current_monthly_rental: 35_000,
    escalation_type: 'percentage',
    escalation_percentage: 8,
    deposit_amount: 70_000,
    deposit_basis_months: 2,
    deposit_held_by: 'landlord',
    deposit_interest_bearing: true,
  },
  expiring: flat,
  expired: flat,
  unverified: { ...flat, deposit_amount: 40_000, deposit_basis_months: 2, deposit_held_by: 'managing_agent', deposit_interest_bearing: false },
}
const GUARANTEES: Record<Scenario, { amount: number; issued_on: ISODate; expires_on: ISODate }> = {
  short: { amount: 105_000, issued_on: addDaysISO(today, -400), expires_on: addDaysISO(today, 900) },
  expiring: { amount: 60_000, issued_on: addDaysISO(today, -400), expires_on: addDaysISO(today, 10) },
  expired: { amount: 60_000, issued_on: addDaysISO(today, -400), expires_on: addDaysISO(today, -5) },
  unverified: { amount: 60_000, issued_on: addDaysISO(today, -400), expires_on: addDaysISO(today, 10) },
}

beforeAll(async () => {
  const ctx = integration()
  const db = serviceRole()
  const marker = `${ctx.runId}sec`.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  const units = check(
    await db
      .from('units')
      .insert(SCENARIOS.map((_, index) => ({ company_id: companyId(), property_id: property().id, unit_number: `G${marker}-${index + 1}`, type: 'line_shop', floor_area_sqm: 120, occupancy_status: 'occupied' })))
      .select('id, unit_number'),
    'Insert the units',
  ) as { id: string; unit_number: string }[]
  const numberBase = randomInt(1_000_000, 9_000_000)
  const tenants = check(
    await db
      .from('tenants')
      .insert(
        SCENARIOS.map((scenario, index) => ({
          company_id: companyId(),
          legal_name: `Security ${scenario} ${marker} (Pty) Ltd`,
          trading_name: `Security ${scenario} ${marker}`,
          business_type: 'pty_ltd',
          contact_full_name: `Security ${scenario} Contact`,
          contact_role: 'Director',
          contact_phone: '+27 11 555 0291',
          whatsapp_number: `+2783${numberBase + index}`,
          whatsapp_verified: true,
          whatsapp_opted_out: false,
          status: 'active',
          industry: 'Retail',
        })),
      )
      .select('id, trading_name'),
    'Insert the tenants',
  ) as { id: string; trading_name: string }[]
  const verifiedAt = new Date().toISOString()
  const leaseRows = check(
    await db
      .from('leases')
      .insert(
        SCENARIOS.map((scenario, index) => {
          const verified = scenario !== 'unverified'
          return {
            company_id: companyId(),
            reference: `SEC-${marker}-${index + 1}`,
            property_id: property().id,
            unit_id: units.find((unit) => unit.unit_number === `G${marker}-${index + 1}`)!.id,
            tenant_id: tenants.find((tenant) => tenant.trading_name === `Security ${scenario} ${marker}`)!.id,
            commencement_date: addDaysISO(today, -400),
            expiry_date: addDaysISO(today, 1100),
            first_escalation_date: addDaysISO(today, -30),
            payment_due_day: 1,
            escalation_frequency: 'annual',
            renewal_option_exists: false,
            ...LEASE_TERMS[scenario],
            status: verified ? 'active' : 'pending_verification',
            verified,
            verified_by_user_id: verified ? world().users.manager.id : null,
            verified_at: verified ? verifiedAt : null,
          }
        }),
      )
      .select('id, reference, unit_id, tenant_id'),
    'Insert the leases',
  ) as { id: string; reference: string; unit_id: string; tenant_id: string }[]
  parties = Object.fromEntries(
    SCENARIOS.map((scenario, index) => {
      const lease = leaseRows.find((row) => row.reference === `SEC-${marker}-${index + 1}`)!
      return [scenario, { unitId: lease.unit_id, tenantId: lease.tenant_id, leaseId: lease.id, reference: lease.reference }]
    }),
  ) as Record<Scenario, Party>
  expectOk(
    await db.from('lease_bank_guarantees').insert(
      SCENARIOS.map((scenario, index) => ({
        company_id: companyId(),
        lease_id: parties[scenario].leaseId,
        bank: 'Standard Bank',
        reference_number: `BG-${marker}-${index + 1}`,
        basis_months: 3,
        status: 'active',
        ...GUARANTEES[scenario],
      })),
    ),
    'Insert the guarantees',
  )

  restoreLogger = logWorkerToFile(path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-reports-deposits-guarantees.log'))
  // The worker's lease monitoring on the local stack only (service role). `onModuleInit` is never called, so no queue
  // is consumed and the runtime is never used.
  const env = loadWorkerEnv(
    workerEnvironment({ NODE_ENV: 'test', SUPABASE_URL: ctx.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey, REDIS_URL: ctx.redisUrl, QUEUE_PREFIX: ctx.queuePrefix }),
  )
  leases = new LeaseMonitoringProcessor({} as ProcessorRuntime, new ServiceRoleClientFactory(env))
})

afterAll(async () => {
  restoreLogger?.()
  if (!parties) return
  const db = serviceRole()
  const all = Object.values(parties)
  const tenantIds = all.map((party) => party.tenantId)
  const events = check(await db.from('monitoring_events').select('id').eq('company_id', companyId()).in('tenant_id', tenantIds), 'Find the events') as { id: string }[]
  if (events.length > 0) {
    const ids = events.map((event) => event.id)
    expectOk(await db.from('notifications').delete().eq('company_id', companyId()).eq('link_entity_type', 'monitoring_event').in('link_entity_id', ids), 'Delete the notifications')
    expectOk(await db.from('monitoring_events').delete().eq('company_id', companyId()).in('id', ids), 'Delete the events')
  }
  expectOk(await db.from('units').update({ current_lease_id: null, current_tenant_id: null }).eq('company_id', companyId()).in('id', all.map((party) => party.unitId)), 'Detach the units')
  expectOk(await db.from('leases').delete().eq('company_id', companyId()).in('id', all.map((party) => party.leaseId)), 'Delete the leases')
  expectOk(await db.from('tenants').delete().eq('company_id', companyId()).in('id', tenantIds), 'Delete the tenants')
  expectOk(await db.from('units').delete().eq('company_id', companyId()).in('id', all.map((party) => party.unitId)), 'Delete the units')
})

interface EventRow {
  type: string
  lease_id: string
  due_date: string | null
  calculation: { expectedAmount?: number; actualAmount?: number; difference?: number } | null
}

describe('GET /api/v1/reports/deposits_guarantees', () => {
  it('works out each verified lease\'s cover after escalation and its guarantee\'s expiry state', async () => {
    const report = await reportOf()
    expect(report.reportId).toBe('deposits_guarantees')
    expect(report.asOf).toBe(today)
    const rowOf = (scenario: Scenario) => report.data.rows.find((row) => row.leaseId === parties[scenario].leaseId)

    expect(rowOf('short')).toMatchObject({
      reference: parties.short.reference,
      propertyId: property().id,
      tenantId: parties.short.tenantId,
      unitId: parties.short.unitId,
      expectedMonthlyRental: 37_800,
      guaranteeAmount: 105_000,
      guaranteeRequired: 113_400,
      guaranteeShortfall: 8_400,
      depositAmount: 70_000,
      depositRequired: 75_600,
      depositShortfall: 5_600,
      guaranteeState: 'active',
      needsAttention: true,
    })
    expect(rowOf('expiring')).toMatchObject({ guaranteeState: 'expiring', guaranteeDaysUntilExpiry: 10, guaranteeShortfall: 0, needsAttention: true })
    expect(rowOf('expired')).toMatchObject({ guaranteeState: 'expired', guaranteeDaysUntilExpiry: -5, needsAttention: true })
    // Unverified terms drive no financial monitoring: never listed.
    expect(rowOf('unverified')).toBeUndefined()

    // The totals are the rows added up, so the CSV of the rows agrees with the strip above it.
    const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
    expect(report.data.guaranteeShortfallTotal).toBe(sum(report.data.rows.map((row) => row.guaranteeShortfall)))
    expect(report.data.depositShortfallTotal).toBe(sum(report.data.rows.map((row) => row.depositShortfall)))
    expect(report.data.totalDeposits).toBe(sum(report.data.rows.map((row) => row.depositAmount ?? 0)))
    expect(report.data.expiringGuarantees).toBe(report.data.rows.filter((row) => row.guaranteeState === 'expiring').length)
  })

  it('counts the unverified leases it leaves out, as the database holds them', async () => {
    const report = await reportOf('a', 'manager', { propertyId: [property().id] })
    const db = serviceRole()
    const rows = check(
      await db
        .from('leases')
        .select('id, deposit_amount, status, lease_bank_guarantees(id)')
        .eq('company_id', companyId())
        .eq('property_id', property().id)
        .eq('verified', false)
        .not('status', 'in', '(expired,renewed,terminated)'),
      'Read the unverified leases',
    ) as { id: string; deposit_amount: number | null; lease_bank_guarantees: { id: string }[] }[]
    const expected = rows.filter((row) => row.deposit_amount !== null || row.lease_bank_guarantees.length > 0).length
    expect(expected).toBeGreaterThanOrEqual(1)
    expect(report.data.unverifiedLeasesExcluded).toBe(expected)
    expect(report.data.rows.every((row) => row.propertyId === property().id)).toBe(true)
  })

  it('matches the events lease monitoring raises for the same leases on the same day', async () => {
    const report = await reportOf()
    for (const scenario of SCENARIOS) {
      await leases.scan({ companyId: companyId(), asOf: today }, { tenantId: parties[scenario].tenantId })
    }
    const events = check(
      await serviceRole()
        .from('monitoring_events')
        .select('type, lease_id, due_date, calculation')
        .eq('company_id', companyId())
        .in('lease_id', SCENARIOS.map((scenario) => parties[scenario].leaseId))
        .in('type', ['guarantee_shortfall', 'deposit_shortfall', 'guarantee_expiry'])
        .overrideTypes<EventRow[], { merge: false }>(),
      'Read the events',
    )
    const eventOf = (scenario: Scenario, type: string) => events.find((event) => event.lease_id === parties[scenario].leaseId && event.type === type)
    const row = (scenario: Scenario) => report.data.rows.find((candidate) => candidate.leaseId === parties[scenario].leaseId)!

    expect(eventOf('short', 'guarantee_shortfall')?.calculation).toMatchObject({
      expectedAmount: row('short').guaranteeRequired,
      actualAmount: row('short').guaranteeAmount,
      difference: row('short').guaranteeShortfall,
    })
    expect(eventOf('short', 'deposit_shortfall')?.calculation).toMatchObject({
      expectedAmount: row('short').depositRequired,
      actualAmount: row('short').depositAmount,
      difference: row('short').depositShortfall,
    })
    // Expiring and expired guarantees raise a guarantee expiry event; an active one does not.
    expect(eventOf('expiring', 'guarantee_expiry')?.due_date).toBe(row('expiring').guaranteeExpiresOn)
    expect(eventOf('expired', 'guarantee_expiry')?.due_date).toBe(row('expired').guaranteeExpiresOn)
    expect(eventOf('short', 'guarantee_expiry')).toBeUndefined()
    // A covering guarantee raises no shortfall; unverified terms raise nothing at all.
    expect(eventOf('expiring', 'guarantee_shortfall')).toBeUndefined()
    expect(events.filter((event) => event.lease_id === parties.unverified.leaseId)).toEqual([])
  })

  it('narrows to guarantee states and the guarantee expiry range, and states the filters back', async () => {
    const expired = await reportOf('a', 'manager', { status: ['expired'] })
    expect(expired.filters).toEqual({ statuses: ['expired'] })
    expect(expired.data.rows.every((row) => row.guaranteeState === 'expired')).toBe(true)
    expect(expired.data.rows.some((row) => row.leaseId === parties.expired.leaseId)).toBe(true)

    const range = await reportOf('a', 'manager', { from: today, to: addDaysISO(today, 20) })
    expect(range.filters).toEqual({ from: today, to: addDaysISO(today, 20) })
    const ids = range.data.rows.map((row) => row.leaseId)
    expect(ids).toContain(parties.expiring.leaseId)
    expect(ids).not.toContain(parties.expired.leaseId)
    expect(ids).not.toContain(parties.short.leaseId)
  })

  it('refuses a status it does not offer and a range that ends before it starts', async () => {
    expect((await apiErrorOf(reportOf('a', 'manager', { status: ['vacant'] }))).status).toBe(400)
    expect((await apiErrorOf(reportOf('a', 'manager', { from: today, to: addDaysISO(today, -1) }))).status).toBe(400)
  })

  it('is read-only, the same for every member role, and never answers for another company', async () => {
    const manager = await reportOf('a', 'manager')
    for (const user of ['admin', 'readOnly', 'owner'] as const) {
      const theirs = await reportOf('a', user)
      expect(theirs.data.rows.find((row) => row.leaseId === parties.short.leaseId), user).toEqual(manager.data.rows.find((row) => row.leaseId === parties.short.leaseId))
    }
    expect((await apiErrorOf(reportOf('b', 'admin'))).status).toBe(403)
    const b = await reportOf('b')
    const aLeases = new Set(Object.values(parties).map((party) => party.leaseId))
    expect(b.data.rows.some((row) => aLeases.has(row.leaseId))).toBe(false)

    const { gatewayBaseUrl, accessTokens } = integration()
    const write = await fetch(`${gatewayBaseUrl}/api/v1/reports/deposits_guarantees`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessTokens.manager}`, 'x-company-id': companyId() },
    })
    expect(write.status).toBe(404)
  })
})
