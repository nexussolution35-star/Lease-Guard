import { generateInstallmentSchedule, type ArrangementInstallment, type PaymentArrangementListItem } from '@leaseguard/domain'

import { NEXUS_ID } from '@/test/accountFixtures'

export const ARRANGEMENT_ID = 'a1b2c3d4-0000-4000-8000-0000000000a1'
export const TENANT_ID = '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10'
export const PROPERTY_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'
export const UNIT_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
export const LEASE_ID = 'c0000000-0000-4000-8000-000000000001'
export const MANAGER_ID = '5b0c1d2e-0000-4000-8000-0000000000a2'

/** R31 000 over five monthly instalments of R6 200 from 15 Aug 2026; the first confirmed paid. Test fixture only. */
export function arrangementFixture(overrides: Partial<PaymentArrangementListItem> = {}): PaymentArrangementListItem {
  const installments: ArrangementInstallment[] = generateInstallmentSchedule({
    arrangementId: ARRANGEMENT_ID,
    outstandingBalance: 31_000,
    installmentAmount: 6_200,
    frequency: 'monthly',
    firstInstallmentDate: '2026-08-15',
  }).map((installment, index) => ({
    ...installment,
    id: `b0000000-0000-4000-8000-00000000000${index + 1}`,
    ...(index === 0
      ? { status: 'confirmed_paid' as const, outcomeRecordedByUserId: MANAGER_ID, outcomeRecordedAt: '2026-09-02T09:00:00+02:00' }
      : {}),
  }))
  return {
    id: ARRANGEMENT_ID,
    companyId: NEXUS_ID,
    tenantId: TENANT_ID,
    propertyId: PROPERTY_ID,
    unitId: UNIT_ID,
    leaseId: LEASE_ID,
    outstandingBalance: 31_000,
    installmentAmount: 6_200,
    frequency: 'monthly',
    firstInstallmentDate: '2026-08-15',
    finalInstallmentDate: '2026-12-15',
    status: 'active',
    suppressArrearsReminders: true,
    agreedByUserId: MANAGER_ID,
    agreedOn: '2026-08-05',
    notes: '',
    installments,
    tenantName: 'Dlamini Cellular',
    propertyName: 'Meadowlands Square',
    unitNumber: 'S03',
    leaseReference: 'MSQ-L003',
    createdAt: '2026-08-05T14:30:00+02:00',
    updatedAt: '2026-09-02T09:00:00+02:00',
    ...overrides,
  }
}
