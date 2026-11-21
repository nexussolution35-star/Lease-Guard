import { describe, expect, it } from 'vitest'

import {
  arrangementChangesFrom,
  arrangementFormDefaults,
  arrangementFormSchema,
  newArrangementFormDefaults,
  newArrangementFrom,
  termsFromForm,
} from './arrangementFormSchema'
import { arrangementFixture, LEASE_ID, PROPERTY_ID, TENANT_ID } from './test/arrangementFixtures'

const filled = {
  ...newArrangementFormDefaults('2026-11-21', TENANT_ID),
  leaseId: LEASE_ID,
  propertyId: PROPERTY_ID,
  outstandingBalance: 10_000,
  installmentAmount: 2_500,
  firstInstallmentDate: '2026-12-01',
}

describe('arrangementFormSchema', () => {
  it('asks for every required field of a new arrangement', () => {
    const result = arrangementFormSchema.safeParse(newArrangementFormDefaults('2026-11-21'))
    expect(result.success).toBe(false)
    const messages = result.error?.issues.map((issue) => issue.message) ?? []
    expect(messages).toEqual(
      expect.arrayContaining([
        'Choose the tenant',
        'Choose the lease the arrears are under',
        'Enter the outstanding balance agreed',
        'Enter the instalment amount',
        'Choose the date of the first instalment',
      ]),
    )
  })

  it('refuses amounts at or below zero and more than two decimals', () => {
    expect(arrangementFormSchema.safeParse({ ...filled, installmentAmount: 0 }).success).toBe(false)
    expect(arrangementFormSchema.safeParse({ ...filled, outstandingBalance: 100.005 }).success).toBe(false)
    expect(arrangementFormSchema.safeParse(filled).success).toBe(true)
  })
})

describe('form values to the API', () => {
  it('records the agreement with the property of the chosen lease and no empty notes', () => {
    expect(newArrangementFrom(arrangementFormSchema.parse(filled))).toEqual({
      tenantId: TENANT_ID,
      propertyId: PROPERTY_ID,
      leaseId: LEASE_ID,
      outstandingBalance: 10_000,
      installmentAmount: 2_500,
      frequency: 'monthly',
      firstInstallmentDate: '2026-12-01',
      agreedOn: '2026-11-21',
      status: 'active',
    })
  })

  it('edits only what changed, and nothing when nothing did', () => {
    const arrangement = arrangementFixture()
    const unchanged = arrangementFormSchema.parse(arrangementFormDefaults(arrangement))
    expect(arrangementChangesFrom(unchanged, arrangement)).toBeNull()
    expect(arrangementChangesFrom({ ...unchanged, installmentAmount: 7_750, notes: 'Revised' }, arrangement)).toEqual({
      installmentAmount: 7_750,
      notes: 'Revised',
    })
  })

  it('reads the terms only once they are all filled in', () => {
    expect(termsFromForm(newArrangementFormDefaults('2026-11-21'))).toBeNull()
    expect(termsFromForm(filled)).toEqual({
      outstandingBalance: 10_000,
      installmentAmount: 2_500,
      frequency: 'monthly',
      agreedOn: '2026-11-21',
      firstInstallmentDate: '2026-12-01',
    })
  })
})
