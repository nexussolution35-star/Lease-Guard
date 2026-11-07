import type { Lease, PaymentArrangement, Statement, Tenant, User } from '../../types/index.js'

const TS = '2026-01-01T08:00:00+02:00'

/** Spec lease: R35 000 commencing 1 Jan 2026, 8% annual escalation from 1 Jan 2027, 5 years. */
export function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: 'lease_test',
    companyId: 'cmp_nexus',
    createdAt: TS,
    updatedAt: TS,
    reference: 'TST-L001',
    propertyId: 'prop_test',
    unitId: 'unit_test',
    tenantId: 'ten_test',
    commencementDate: '2026-01-01',
    expiryDate: '2030-12-31',
    initialMonthlyRental: 35000,
    currentMonthlyRental: 35000,
    paymentDueDay: 1,
    escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2027-01-01' },
    renewalOption: { exists: true, renewalTermMonths: 60, noticePeriodMonths: 3, exercised: false },
    status: 'active',
    verified: true,
    ...overrides,
  }
}

export function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'ten_test',
    companyId: 'cmp_nexus',
    createdAt: TS,
    updatedAt: TS,
    legalName: 'Test Trading (Pty) Ltd',
    tradingName: 'Test Trading',
    businessType: 'pty_ltd',
    primaryContact: { fullName: 'Thabo Test', role: 'Owner', phone: '+27821234567' },
    whatsappNumber: '+27821234567',
    whatsappVerified: true,
    whatsappOptedOut: false,
    status: 'active',
    industry: 'Retail',
    ...overrides,
  }
}

export function makeArrangement(overrides: Partial<PaymentArrangement> = {}): PaymentArrangement {
  return {
    id: 'arr_test',
    companyId: 'cmp_nexus',
    createdAt: TS,
    updatedAt: TS,
    tenantId: 'ten_test',
    propertyId: 'prop_test',
    unitId: 'unit_test',
    leaseId: 'lease_test',
    outstandingBalance: 30000,
    installmentAmount: 10000,
    frequency: 'monthly',
    firstInstallmentDate: '2026-11-15',
    finalInstallmentDate: '2027-01-15',
    status: 'active',
    suppressArrearsReminders: true,
    agreedByUserId: 'usr_pm',
    agreedOn: '2026-11-01',
    notes: '',
    installments: [],
    ...overrides,
  }
}

export function makeStatement(overrides: Partial<Statement> = {}): Statement {
  return {
    id: 'stm_test',
    companyId: 'cmp_nexus',
    createdAt: TS,
    updatedAt: TS,
    propertyId: 'prop_test',
    tenantId: 'ten_test',
    leaseId: 'lease_test',
    file: {
      fileName: 'statement.pdf',
      storagePath: 'statements/statement.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      sha256: 'a'.repeat(64),
    },
    sourceSystem: 'MRI',
    statementNumber: 'ST-001',
    statementDate: '2026-10-01',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'verified',
    uploadedByUserId: 'usr_pm',
    uploadedAt: TS,
    closingBalance: 0,
    lineItems: [],
    ...overrides,
  }
}

export function makeOwner(overrides: Partial<User> = {}): User {
  return {
    id: 'usr_owner',
    createdAt: TS,
    updatedAt: TS,
    fullName: 'Owner Person',
    email: 'owner@example.co.za',
    whatsappNumber: '+27831234567',
    status: 'active',
    memberships: [{ companyId: 'cmp_nexus', role: 'property_owner', isDefault: true, joinedAt: TS }],
    ...overrides,
  }
}
