import { unwrap, type CreateLeaseDto } from '@leaseguard/api-client'
import { leaseStatusAfterTermChange } from '@leaseguard/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Lease create and edit (PRD module 5, ticket M5-01) through the real API and the local database: writers create a
 * lease with its bank guarantee; the reference is unique in the company and the tenant, property and unit must belong
 * together; members who only read are refused and another company's lease is not found; a term change of a verified
 * lease (the guarantee included) returns it to pending verification, and every change reaches the audit log.
 */

/** `supabase db query` starts a process per call and is slow while other suites share the machine. */
const SLOW = 90_000

const reference = `ZL-${integration().runId}`.slice(0, 40).toUpperCase()

/** A vacant unit this file adds to the first property of company A, and the lease it creates there. */
let unitId: string | undefined
let leaseId: string | undefined

const property = () => world().companies.a.properties[0]!
const tenant = () => world().companies.a.tenants[0]!

beforeAll(async () => {
  const unit = await unwrap(
    apiAs('manager', 'a').POST('/api/v1/units', {
      body: { propertyId: property().id, unitNumber: `ZL-${integration().runId}`.slice(0, 30), type: 'kiosk', floorAreaSqm: 10 },
    }),
  )
  unitId = unit.id
}, SLOW)

afterAll(async () => {
  const a = world().companies.a.id
  const db = serviceRole()
  if (leaseId) {
    expectOk(await db.from('lease_bank_guarantees').delete().eq('company_id', a).eq('lease_id', leaseId), 'Delete this file’s guarantee')
    expectOk(await db.from('leases').delete().eq('company_id', a).eq('id', leaseId), 'Delete this file’s lease')
  }
  if (unitId) expectOk(await db.from('units').delete().eq('company_id', a).eq('id', unitId), 'Delete this file’s unit')
})

const newLease = (overrides: Partial<CreateLeaseDto> = {}): CreateLeaseDto => ({
  reference: reference.toLowerCase(),
  tenantId: tenant().id,
  propertyId: property().id,
  unitId: unitId!,
  commencementDate: '2026-01-01',
  expiryDate: '2030-12-31',
  initialMonthlyRental: 35000,
  paymentDueDay: 1,
  escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2027-01-01' },
  renewalOption: { exists: true, renewalTermMonths: 60, noticePeriodMonths: 6 },
  deposit: { amount: 70000, heldBy: 'landlord', interestBearing: true },
  bankGuarantee: { bank: 'Nedbank', referenceNumber: 'G-77', amount: 105000, basisMonths: 3, issuedOn: '2026-01-01', expiresOn: '2031-03-31' },
  ...overrides,
})

/** Every audit summary for one record, oldest first, read as the database owner. */
async function auditSummaries(entityId: string): Promise<string[]> {
  if (!/^[0-9a-f-]{36}$/.test(entityId)) throw new Error(`Not a uuid: ${entityId}`)
  const rows = (await localSql(
    `select summary from public.audit_logs where entity_id = '${entityId}' order by occurred_at, created_at, id`,
  )) as { summary: string }[]
  return rows.map((row) => row.summary)
}

const path = () => ({ params: { path: { leaseId: leaseId! } } })

describe('leases: create', () => {
  it('lets a property manager create an unverified lease with its guarantee, audited', async () => {
    const lease = await unwrap(apiAs('manager', 'a').POST('/api/v1/leases', { body: newLease() }))
    leaseId = lease.id
    expect(lease).toMatchObject({
      companyId: world().companies.a.id,
      reference,
      currentMonthlyRental: 35000,
      status: 'pending_verification',
      verified: false,
      deposit: { amount: 70000, heldBy: 'landlord', interestBearing: true },
      bankGuarantee: { bank: 'Nedbank', amount: 105000, expiresOn: '2031-03-31', status: 'active' },
      renewalOption: { exists: true, noticePeriodMonths: 6, exercised: false },
    })
    expect(lease).not.toHaveProperty('verifiedByUserId')
    // One transaction: both entries share a time, so their order is not defined.
    expect((await auditSummaries(lease.id)).sort()).toEqual([`Lease ${reference} bank guarantee added`, `Lease ${reference} created`])
  }, SLOW)

  it('refuses a reference already used in the company (409)', async () => {
    const taken = world().companies.a.leases[0]!.reference
    const error = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/leases', { body: newLease({ reference: taken }) })))
    expect(error.status).toBe(409)
    expect(error.messages.join(' ')).toBe(`A lease with the reference ${taken.toUpperCase()} already exists in this workspace`)
  })

  it('refuses a unit from another property and a tenant from another company (422)', async () => {
    const otherUnit = world().companies.a.units.find((u) => u.propertyId !== property().id)
    if (!otherUnit) throw new Error('The world has no unit outside the first property of company A')
    const wrongUnit = await apiErrorOf(
      unwrap(apiAs('manager', 'a').POST('/api/v1/leases', { body: newLease({ reference: `${reference}-X`, unitId: otherUnit.id }) })),
    )
    expect(wrongUnit.status).toBe(422)
    expect(wrongUnit.messages.join(' ')).toBe('The unit is not in the selected property')

    const outsider = await apiErrorOf(
      unwrap(apiAs('manager', 'a').POST('/api/v1/leases', { body: newLease({ reference: `${reference}-X`, tenantId: world().companies.b.tenants[0]!.id }) })),
    )
    expect(outsider.status).toBe(422)
    expect(outsider.messages.join(' ')).toBe('The tenant is not in this workspace')
  })

  it('validates the body (400) and refuses members who only read (403)', async () => {
    const invalid = await apiErrorOf(
      unwrap(apiAs('admin', 'a').POST('/api/v1/leases', { body: newLease({ expiryDate: '2025-12-31', paymentDueDay: 31 }) })),
    )
    expect(invalid.status).toBe(400)
    expect(invalid.messages).toEqual(expect.arrayContaining(['expiryDate: must be after the commencement date', 'paymentDueDay: must be between 1 and 28']))

    for (const user of ['readOnly', 'owner'] as const) {
      const refused = await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/leases', { body: newLease({ reference: `${reference}-X` }) })))
      expect(refused.status).toBe(403)
    }
  })
})

describe('leases: edit and verification', () => {
  const verify = () => unwrap(apiAs('manager', 'a').POST('/api/v1/leases/{leaseId}/verify', path()))

  it('keeps the verification for a note and resets it, audited, for a changed term', async () => {
    const verified = await verify()
    expect(verified.verified).toBe(true)

    const noted = await unwrap(apiAs('admin', 'a').PATCH('/api/v1/leases/{leaseId}', { ...path(), body: { notes: 'Keys handed over' } }))
    expect(noted).toMatchObject({ verified: true, notes: 'Keys handed over', verifiedByUserId: world().users.manager.id })

    const changed = await unwrap(apiAs('admin', 'a').PATCH('/api/v1/leases/{leaseId}', { ...path(), body: { currentMonthlyRental: 37800 } }))
    expect(changed).toMatchObject({ verified: false, currentMonthlyRental: 37800, status: leaseStatusAfterTermChange(verified.status) })
    expect(changed.status).toBe('pending_verification')
    expect(changed).not.toHaveProperty('verifiedByUserId')
    expect(changed).not.toHaveProperty('verifiedAt')
    expect(await auditSummaries(leaseId!)).toContain(`Lease ${reference} terms changed; verification reset`)
  }, SLOW)

  it('resets the verification when the guarantee is removed', async () => {
    await verify()
    const removed = await unwrap(apiAs('manager', 'a').PATCH('/api/v1/leases/{leaseId}', { ...path(), body: { bankGuarantee: null } }))
    expect(removed).not.toHaveProperty('bankGuarantee')
    expect(removed).toMatchObject({ verified: false, status: 'pending_verification' })
    expect(await auditSummaries(leaseId!)).toContain(`Lease ${reference} bank guarantee removed`)
  }, SLOW)

  it('refuses an expiry before the stored commencement (422) and members who only read (403)', async () => {
    const dates = await apiErrorOf(unwrap(apiAs('manager', 'a').PATCH('/api/v1/leases/{leaseId}', { ...path(), body: { expiryDate: '2025-06-30' } })))
    expect(dates.status).toBe(422)
    expect(dates.messages.join(' ')).toBe('The expiry date must be after the commencement date')

    const refused = await apiErrorOf(unwrap(apiAs('readOnly', 'a').PATCH('/api/v1/leases/{leaseId}', { ...path(), body: { notes: 'x' } })))
    expect(refused.status).toBe(403)
  })

  it('does not find the lease from another company (404)', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'b').PATCH('/api/v1/leases/{leaseId}', { ...path(), body: { notes: 'x' } })))
    expect(error.status).toBe(404)
  })
})
