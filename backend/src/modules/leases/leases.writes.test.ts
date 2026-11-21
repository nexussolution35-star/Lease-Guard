import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { fakeDb, rpcArgs, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { createLeaseBodySchema, updateLeaseBodySchema } from './leases.schemas'
import { LeasesService } from './leases.service'
import { COMPANY, guaranteeRow, leaseRow } from './leases.test-helpers'
import { leaseChangesFrom, leaseInsertFrom } from './leases.writes'

const LEASE_ID = leaseRow.id

const newLease = {
  reference: ' msq-l077 ',
  tenantId: leaseRow.tenant_id,
  propertyId: leaseRow.property_id,
  unitId: leaseRow.unit_id,
  commencementDate: '2026-01-01',
  expiryDate: '2030-12-31',
  initialMonthlyRental: 35000,
  paymentDueDay: 1,
  escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2027-01-01' },
  renewalOption: { exists: true, renewalTermMonths: 60, noticePeriodMonths: 6 },
}

const guarantee = {
  bank: 'Nedbank',
  referenceNumber: 'G-77',
  amount: 105000,
  basisMonths: 3,
  issuedOn: '2026-01-01',
  expiresOn: '2031-03-31',
}

const messagesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`)

describe('lease write bodies', () => {
  it('accepts a full new lease, upper-casing and trimming the reference', () => {
    const body = createLeaseBodySchema.parse({ ...newLease, bankGuarantee: guarantee, deposit: null, notes: '' })
    expect(body.reference).toBe('MSQ-L077')
    expect(body.notes).toBeNull()
  })

  it('requires the amount the escalation type names', () => {
    const result = createLeaseBodySchema.safeParse({ ...newLease, escalation: { ...newLease.escalation, type: 'fixed_amount' } })
    expect(messagesOf(result)).toEqual(['escalation.fixedAmount: is required for a fixed amount escalation'])
    expect(createLeaseBodySchema.safeParse({ ...newLease, escalation: { type: 'none', frequency: 'annual', firstEscalationDate: '2027-01-01' } }).success).toBe(true)
  })

  it('refuses an expiry on or before commencement, a guarantee expiring before issue, and amounts with cents beyond two decimals', () => {
    expect(messagesOf(createLeaseBodySchema.safeParse({ ...newLease, expiryDate: '2026-01-01' }))).toEqual([
      'expiryDate: must be after the commencement date',
    ])
    expect(messagesOf(createLeaseBodySchema.safeParse({ ...newLease, bankGuarantee: { ...guarantee, expiresOn: '2025-12-31' } }))).toEqual([
      'bankGuarantee.expiresOn: must be after the issue date',
    ])
    expect(messagesOf(createLeaseBodySchema.safeParse({ ...newLease, initialMonthlyRental: 100.005 }))).toEqual([
      'initialMonthlyRental: must have at most two decimals',
    ])
    expect(messagesOf(createLeaseBodySchema.safeParse({ ...newLease, paymentDueDay: 31 }))).toEqual(['paymentDueDay: must be between 1 and 28'])
  })

  it('refuses unknown fields, including verification and statuses past pending', () => {
    expect(createLeaseBodySchema.safeParse({ ...newLease, verified: true }).success).toBe(false)
    expect(createLeaseBodySchema.safeParse({ ...newLease, status: 'active' }).success).toBe(false)
    expect(updateLeaseBodySchema.safeParse({ status: 'active' }).success).toBe(false)
  })

  it('needs a change, and the unit with a new property', () => {
    expect(messagesOf(updateLeaseBodySchema.safeParse({}))).toEqual([': Change at least one field'])
    expect(messagesOf(updateLeaseBodySchema.safeParse({ propertyId: leaseRow.property_id }))).toEqual(['unitId: send the unit with the property'])
    expect(updateLeaseBodySchema.safeParse({ unitId: leaseRow.unit_id }).success).toBe(true)
    expect(updateLeaseBodySchema.parse({ bankGuarantee: null }).bankGuarantee).toBeNull()
  })
})

describe('lease write columns', () => {
  it('maps a new lease to every column, the current rental defaulting to the initial one and no deposit cleared', () => {
    const columns = leaseInsertFrom(createLeaseBodySchema.parse(newLease))
    expect(columns).toMatchObject({
      reference: 'MSQ-L077',
      initial_monthly_rental: 35000,
      current_monthly_rental: 35000,
      escalation_type: 'percentage',
      escalation_percentage: 8,
      escalation_fixed_amount: null,
      renewal_option_exists: true,
      renewal_notice_period_months: 6,
      deposit_amount: null,
      deposit_held_by: null,
      status: 'pending_verification',
      notes: null,
    })
    expect(columns).not.toHaveProperty('verified')
  })

  it('maps only the changed fields; a group replaces all its columns and a null deposit clears them', () => {
    expect(leaseChangesFrom(updateLeaseBodySchema.parse({ currentMonthlyRental: 37800 }))).toEqual({ current_monthly_rental: 37800 })
    expect(leaseChangesFrom(updateLeaseBodySchema.parse({ deposit: null }))).toEqual({
      deposit_amount: null,
      deposit_basis_months: null,
      deposit_held_by: null,
      deposit_received_on: null,
      deposit_interest_bearing: null,
      deposit_notes: null,
    })
    expect(
      leaseChangesFrom(updateLeaseBodySchema.parse({ escalation: { type: 'cpi_linked', cpiAssumedPercentage: 5.5, cpiMarginPercentage: 1, frequency: 'annual', firstEscalationDate: '2027-01-01' } })),
    ).toEqual({
      escalation_type: 'cpi_linked',
      escalation_percentage: null,
      escalation_fixed_amount: null,
      escalation_cpi_assumed_percentage: 5.5,
      escalation_cpi_margin_percentage: 1,
      escalation_frequency: 'annual',
      first_escalation_date: '2027-01-01',
    })
  })
})

describe('LeasesService create and update', () => {
  const service = new LeasesService()
  const isSave = (query: RecordedQuery) => query.table === 'rpc:save_lease'
  const leaseRead = { data: { ...leaseRow, lease_bank_guarantees: [guaranteeRow] }, error: null }

  it('creates the lease and its guarantee in one save_lease call, then reads it back', async () => {
    const { client, queries } = fakeDb((query) => (isSave(query) ? { data: LEASE_ID, error: null } : leaseRead))

    const lease = await service.create(client, COMPANY, createLeaseBodySchema.parse({ ...newLease, bankGuarantee: guarantee }))

    expect(lease.id).toBe(LEASE_ID)
    const args = rpcArgs(queries.find(isSave)!)
    expect(args).toMatchObject({
      p_company_id: COMPANY,
      p_set_guarantee: true,
      p_guarantee: { bank: 'Nedbank', reference_number: 'G-77', amount: 105000, basis_months: 3, issued_on: '2026-01-01', expires_on: '2031-03-31', notes: null },
      p_lease: { reference: 'MSQ-L077', status: 'pending_verification' },
    })
    expect(args).not.toHaveProperty('p_lease_id')
  })

  it('answers a reference already used with 409 naming it, and a guard refusal with its words (422)', async () => {
    const duplicate = fakeDb(() => ({ data: null, error: { code: '23505', message: 'leases_company_reference_key' } }))
    await expect(service.create(duplicate.client, COMPANY, createLeaseBodySchema.parse(newLease))).rejects.toThrow(
      new ConflictException('A lease with the reference MSQ-L077 already exists in this workspace'),
    )

    const guard = fakeDb(() => ({ data: null, error: { code: 'P0001', message: 'The unit is not in the selected property' } }))
    await expect(service.create(guard.client, COMPANY, createLeaseBodySchema.parse(newLease))).rejects.toThrow(
      new UnprocessableEntityException('The unit is not in the selected property'),
    )
  })

  it('updates only the fields sent and removes the guarantee on null', async () => {
    const { client, queries } = fakeDb((query) => (isSave(query) ? { data: LEASE_ID, error: null } : leaseRead))

    await service.update(client, COMPANY, LEASE_ID, updateLeaseBodySchema.parse({ currentMonthlyRental: 37800, bankGuarantee: null }))

    expect(rpcArgs(queries.find(isSave)!)).toEqual({
      p_company_id: COMPANY,
      p_lease_id: LEASE_ID,
      p_lease: { current_monthly_rental: 37800 },
      p_set_guarantee: true,
    })
  })

  it('leaves the guarantee alone when the body does not name it', async () => {
    const { client, queries } = fakeDb((query) => (isSave(query) ? { data: LEASE_ID, error: null } : leaseRead))
    await service.update(client, COMPANY, LEASE_ID, updateLeaseBodySchema.parse({ notes: 'Keys handed over' }))
    expect(rpcArgs(queries.find(isSave)!)).toMatchObject({ p_set_guarantee: false, p_lease: { notes: 'Keys handed over' } })
  })

  it('refuses an expiry on or before the stored commencement (422) without writing', async () => {
    const { client, queries } = fakeDb(() => leaseRead)
    await expect(
      service.update(client, COMPANY, LEASE_ID, updateLeaseBodySchema.parse({ expiryDate: leaseRow.commencement_date })),
    ).rejects.toThrow(new UnprocessableEntityException('The expiry date must be after the commencement date'))
    expect(queries.some(isSave)).toBe(false)
  })

  it('returns 404 for a lease that is not visible, without writing', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.update(client, COMPANY, LEASE_ID, updateLeaseBodySchema.parse({ notes: 'x' }))).rejects.toBeInstanceOf(NotFoundException)
    expect(queries.some(isSave)).toBe(false)
  })
})
