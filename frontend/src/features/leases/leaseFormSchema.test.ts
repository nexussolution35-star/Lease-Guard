import { editRequiresReverification, type Lease } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { sampleRecord } from '@/test/fakeApi'

import {
  leaseChangesFrom,
  leaseFieldErrors,
  leaseFormDefaults,
  leaseFormSchema,
  leaseWithChanges,
  newLeaseFormDefaults,
  newLeaseFrom,
  type LeaseFormInput,
} from './leaseFormSchema'

const LEASE: Lease = {
  ...sampleRecord('leases'),
  deposit: { amount: 370000, basisMonths: 2, heldBy: 'landlord', receivedOn: '2023-02-20', interestBearing: true },
  notes: 'Anchor tenant',
}

const input = (overrides: Partial<LeaseFormInput> = {}): LeaseFormInput => ({ ...leaseFormDefaults(LEASE), ...overrides })
const parse = (overrides: Partial<LeaseFormInput> = {}) => leaseFormSchema.parse(input(overrides))
const issues = (value: LeaseFormInput) => {
  const result = leaseFormSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

describe('leaseFormSchema', () => {
  it('accepts a saved lease and upper-cases the reference', () => {
    expect(parse({ reference: ' msq-l014 ' }).reference).toBe('MSQ-L014')
  })

  it('needs every party, both dates, the rental, the due day and an escalation type on a new lease', () => {
    expect(issues(newLeaseFormDefaults())).toEqual(
      expect.arrayContaining([
        'reference: Enter the lease reference',
        'tenantId: Choose the tenant',
        'propertyId: Choose the property',
        'unitId: Choose the unit',
        'commencementDate: Choose the commencement date',
        'expiryDate: Choose the expiry date',
        'initialMonthlyRental: Enter the monthly rental at commencement',
        'paymentDueDay: Enter the day rental is due',
        'escalation.type: Choose the escalation type',
      ]),
    )
  })

  it.each([
    [{ reference: 'MSQ L1' }, 'reference: Use letters, digits, hyphens or slashes, e.g. MSQ-L012'],
    [{ paymentDueDay: 29 }, 'paymentDueDay: Use a day from 1 to 28'],
    [{ initialMonthlyRental: 10.005 }, 'initialMonthlyRental: Use at most two decimals'],
    [{ expiryDate: '2023-03-01' }, 'expiryDate: The lease must expire after it commences'],
  ])('rejects %j', (overrides, message) => {
    expect(issues(input(overrides))).toEqual([message])
  })

  it('asks for the amount the escalation type uses and its first date', () => {
    expect(issues(input({ escalation: { type: 'fixed_amount', frequency: 'annual' } }))).toEqual([
      'escalation.fixedAmount: Enter the fixed increase',
      'escalation.firstEscalationDate: Choose the date of the first escalation',
    ])
    expect(issues(input({ escalation: { type: 'cpi_linked', frequency: 'annual', firstEscalationDate: '2024-03-01' } }))).toEqual([
      'escalation.cpiAssumedPercentage: Enter the assumed CPI',
    ])
    expect(issues(input({ escalation: { type: 'none', frequency: 'annual' } }))).toEqual([])
  })

  it('needs the deposit and guarantee details only when they are held', () => {
    expect(issues(input({ deposit: { held: true, heldBy: '', interestBearing: false, notes: '' } }))).toEqual([
      'deposit.amount: Enter the deposit amount',
      'deposit.heldBy: Choose who holds the deposit',
    ])
    expect(issues(input({ deposit: { held: false, heldBy: '', interestBearing: false, notes: '' } }))).toEqual([])
    const guarantee = leaseFormDefaults(LEASE).bankGuarantee
    expect(issues(input({ bankGuarantee: { ...guarantee, bank: ' ', expiresOn: '2023-01-01' } }))).toEqual([
      'bankGuarantee.bank: Enter the bank',
      'bankGuarantee.expiresOn: The guarantee must expire after its issue date',
    ])
  })
})

describe('newLeaseFrom', () => {
  const values = parse({ currentMonthlyRental: undefined, notes: '', deposit: { held: false, heldBy: '', interestBearing: false, notes: '' } })

  it('builds the create body: no current rental (the API uses the initial one), no deposit, the guarantee and renewal as captured', () => {
    expect(newLeaseFrom(values)).toEqual({
      reference: 'MSQ-L001',
      tenantId: LEASE.tenantId,
      propertyId: LEASE.propertyId,
      unitId: LEASE.unitId,
      commencementDate: '2023-03-01',
      expiryDate: '2028-02-29',
      initialMonthlyRental: 185000,
      paymentDueDay: 1,
      escalation: { type: 'percentage', percentage: 7, frequency: 'annual', firstEscalationDate: '2024-03-01' },
      renewalOption: { exists: true, renewalTermMonths: 60, noticePeriodMonths: 9, notes: 'Anchor tenant renewal on the same escalation terms.' },
      bankGuarantee: {
        bank: 'Standard Bank',
        referenceNumber: 'SBG/2023/0045812',
        amount: 555000,
        basisMonths: 3,
        issuedOn: '2023-02-15',
        expiresOn: '2028-03-31',
        notes: 'Sized at 3 months of initial rental; not topped up after escalations.',
      },
    })
  })

  it('sends only the amount the escalation type uses, and the commencement as the unused date of no escalation', () => {
    const none = parse({ escalation: { type: 'none', percentage: 7, frequency: 'annual' } })
    expect(newLeaseFrom(none).escalation).toEqual({ type: 'none', frequency: 'annual', firstEscalationDate: '2023-03-01' })
  })
})

describe('leaseChangesFrom', () => {
  it('is null when nothing changed', () => {
    expect(leaseChangesFrom(parse(), LEASE)).toBeNull()
  })

  it('sends changed scalars, whole changed groups, null for a removed deposit and emptied notes', () => {
    const values = parse({
      paymentDueDay: 7,
      escalation: { ...leaseFormDefaults(LEASE).escalation, percentage: 8 },
      deposit: { held: false, heldBy: '', interestBearing: false, notes: '' },
      notes: '',
    })
    expect(leaseChangesFrom(values, LEASE)).toEqual({
      paymentDueDay: 7,
      escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2024-03-01' },
      deposit: null,
      notes: null,
    })
  })

  it('sends the unit with a new property, and an emptied current rental as the initial rental', () => {
    expect(leaseChangesFrom(parse({ propertyId: 'prop_other', currentMonthlyRental: undefined }), LEASE)).toEqual({
      propertyId: 'prop_other',
      unitId: LEASE.unitId,
      currentMonthlyRental: 185000,
    })
  })
})

describe('leaseWithChanges and the re-verification warning', () => {
  it('warns for a term change of a verified lease, not for the reference or notes', () => {
    const changes = (overrides: Partial<LeaseFormInput>) => leaseChangesFrom(parse(overrides), LEASE) ?? {}
    expect(editRequiresReverification(LEASE, leaseWithChanges(LEASE, changes({ expiryDate: '2029-02-28' })))).toBe(true)
    expect(editRequiresReverification(LEASE, leaseWithChanges(LEASE, changes({ deposit: { held: false, heldBy: '', interestBearing: false, notes: '' } })))).toBe(true)
    expect(editRequiresReverification(LEASE, leaseWithChanges(LEASE, changes({ reference: 'MSQ-L001A', notes: 'Filed' })))).toBe(false)
  })

  it('keeps the renewal exercise and the guarantee status', () => {
    const exercised: Lease = { ...LEASE, renewalOption: { ...LEASE.renewalOption, exercised: true, exercisedOn: '2027-05-01' } }
    const next = leaseWithChanges(exercised, { renewalOption: { exists: true, renewalTermMonths: 36 }, bankGuarantee: { ...LEASE.bankGuarantee!, amount: 600000 } })
    expect(next.renewalOption).toEqual({ exists: true, renewalTermMonths: 36, exercised: true, exercisedOn: '2027-05-01' })
    expect(next.bankGuarantee?.status).toBe('active')
  })
})

describe('leaseFieldErrors', () => {
  it('places each 400 problem on its field and leaves the rest to the form', () => {
    expect(leaseFieldErrors(400, ['escalation.percentage: must be 0 or more', 'bankGuarantee.expiresOn: must be after the issue date', 'Change at least one field'])).toEqual([
      { field: 'escalation.percentage', message: 'Must be 0 or more.' },
      { field: 'bankGuarantee.expiresOn', message: 'Must be after the issue date.' },
    ])
  })

  it.each([
    [409, 'A lease with the reference MSQ-L001 already exists in this workspace', 'reference'],
    [422, 'The tenant is not in this workspace', 'tenantId'],
    [422, 'This property is archived. Restore it before adding leases to it.', 'propertyId'],
    [422, 'The unit is not in the selected property', 'unitId'],
  ])('places %i %j on %s', (status, message, field) => {
    expect(leaseFieldErrors(status, [message]).map((error) => error.field)).toEqual([field])
  })

  it('leaves a refusal of the whole lease to the form', () => {
    expect(leaseFieldErrors(422, ['This lease already has statements, arrangements, monitoring events or messages, or is the unit\'s current lease, so its tenant, property and unit cannot change.'])).toEqual([])
    expect(leaseFieldErrors(500, ['boom'])).toEqual([])
  })
})
