/**
 * Small, self-contained Collections fixture for store and service tests.
 * Independent of `src/data`; returns a fresh deep copy on every call.
 */
import { emptyCollections, toRecordMap, type Collections } from '@/store/collections'
import type {
  Address,
  Company,
  Lease,
  MessageTemplate,
  MonitoringEvent,
  MonitoringRule,
  Notification,
  Property,
  Statement,
  StatementExtraction,
  Tenant,
  Unit,
  User,
} from '@leaseguard/domain'

const T0 = '2026-01-15T08:00:00+02:00'
const REF_DATE = '2026-11-06'

export const FIXTURE_IDS = {
  companies: { nexus: 'cmp_nexus', atlas: 'cmp_atlas' },
  users: { thandi: 'usr_thandi', sipho: 'usr_sipho' },
  properties: { soweto: 'prop_mall_of_soweto', umhlanga: 'prop_umhlanga_office_park' },
  units: { sowetoA1: 'unit_msq_a1', sowetoA2: 'unit_msq_a2', umhlangaB1: 'unit_uop_b1' },
  tenants: { pickNPay: 'ten_pick_n_pay_soweto', coastalLaw: 'ten_coastal_law' },
  leases: { pickNPay: 'lease_msq_l001', coastalLaw: 'lease_uop_l001' },
  statements: { pickNPayOct: 'stm_msq_l001_2026_10' },
  extractions: { pickNPayOct: 'ext_msq_l001_2026_10' },
  events: { escalation: 'evt_msq_escalation_001' },
  rules: { escalation: 'rule_nexus_escalation' },
  templates: { monthlyStatement: 'tpl_nexus_monthly_statement' },
  notifications: { thandi: 'ntf_thandi_001', sipho: 'ntf_sipho_001' },
} as const

export const FIXTURE_REFERENCE_DATE = REF_DATE

const sowetoAddress: Address = {
  line1: 'Corner Chris Hani Rd & Mojalefa St',
  suburb: 'Pimville',
  city: 'Soweto',
  province: 'Gauteng',
  postalCode: '1809',
  country: 'South Africa',
}

const umhlangaAddress: Address = {
  line1: '12 Lighthouse Rd',
  suburb: 'Umhlanga Ridge',
  city: 'Durban',
  province: 'KwaZulu-Natal',
  postalCode: '4319',
  country: 'South Africa',
}

function company(id: string, name: string, initials: string, address: Address, requireApproval: boolean): Company {
  return {
    id,
    createdAt: T0,
    updatedAt: T0,
    name,
    address,
    contactEmail: `info@${initials.toLowerCase()}.co.za`,
    contactPhone: '+27 11 555 0100',
    status: 'active',
    initials,
    whatsapp: {
      businessAccountId: `waba_${initials.toLowerCase()}`,
      phoneNumberId: `pn_${initials.toLowerCase()}`,
      displayName: name,
      displayNumber: '+27 11 555 0100',
      accessTokenReference: `secret://${initials.toLowerCase()}/whatsapp`,
      webhookConfigured: true,
      connectionStatus: 'connected',
    },
    settings: {
      leaseExpiryNoticeDays: [180, 90, 30],
      renewalDeadlineWarningDays: [60, 30, 7],
      guaranteeExpiryNoticeDays: [90, 30],
      paymentReminderOffsetsDays: { initial: 3, overdue: 10, followUp: 20 },
      installmentReminderLeadDays: 2,
      ownerSummaryWeekday: 'monday',
      requireApprovalForTenantMessages: requireApproval,
      timezone: 'Africa/Johannesburg',
    },
  }
}

const companies: Company[] = [
  company(FIXTURE_IDS.companies.nexus, 'Nexus Solution', 'NS', sowetoAddress, true),
  company(FIXTURE_IDS.companies.atlas, 'Atlas Property Group', 'AP', umhlangaAddress, false),
]

const users: User[] = [
  {
    id: FIXTURE_IDS.users.thandi,
    createdAt: T0,
    updatedAt: T0,
    fullName: 'Thandi Mokoena',
    email: 'thandi@nexussolution.co.za',
    phone: '+27821110001',
    jobTitle: 'Property Manager',
    status: 'active',
    memberships: [
      { companyId: FIXTURE_IDS.companies.nexus, role: 'property_manager', isDefault: true, joinedAt: T0 },
    ],
  },
  {
    id: FIXTURE_IDS.users.sipho,
    createdAt: T0,
    updatedAt: T0,
    fullName: 'Sipho Dlamini',
    email: 'sipho@atlasproperty.co.za',
    phone: '+27821110002',
    jobTitle: 'Managing Director',
    status: 'active',
    memberships: [
      { companyId: FIXTURE_IDS.companies.atlas, role: 'company_admin', isDefault: true, joinedAt: T0 },
      { companyId: FIXTURE_IDS.companies.nexus, role: 'read_only', isDefault: false, joinedAt: T0 },
    ],
  },
]

const properties: Property[] = [
  {
    id: FIXTURE_IDS.properties.soweto,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    name: 'Mall of Soweto',
    code: 'MSQ',
    type: 'shopping_centre',
    address: sowetoAddress,
    description: 'Regional shopping centre in Pimville.',
    status: 'active',
    grossLettableAreaSqm: 42_000,
    managerUserId: FIXTURE_IDS.users.thandi,
    accountingSystem: 'MRI',
  },
  {
    id: FIXTURE_IDS.properties.umhlanga,
    companyId: FIXTURE_IDS.companies.atlas,
    createdAt: T0,
    updatedAt: T0,
    name: 'Umhlanga Office Park',
    code: 'UOP',
    type: 'office',
    address: umhlangaAddress,
    description: 'A-grade office park.',
    status: 'active',
    grossLettableAreaSqm: 9_500,
    managerUserId: FIXTURE_IDS.users.sipho,
    accountingSystem: 'MDA',
  },
]

const units: Unit[] = [
  {
    id: FIXTURE_IDS.units.sowetoA1,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    propertyId: FIXTURE_IDS.properties.soweto,
    unitNumber: 'A1',
    type: 'anchor_retail',
    floorAreaSqm: 3_200,
    floor: 'Ground',
    occupancyStatus: 'occupied',
    currentTenantId: FIXTURE_IDS.tenants.pickNPay,
    currentLeaseId: FIXTURE_IDS.leases.pickNPay,
  },
  {
    id: FIXTURE_IDS.units.sowetoA2,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    propertyId: FIXTURE_IDS.properties.soweto,
    unitNumber: 'A2',
    type: 'line_shop',
    floorAreaSqm: 180,
    floor: 'Ground',
    occupancyStatus: 'vacant',
  },
  {
    id: FIXTURE_IDS.units.umhlangaB1,
    companyId: FIXTURE_IDS.companies.atlas,
    createdAt: T0,
    updatedAt: T0,
    propertyId: FIXTURE_IDS.properties.umhlanga,
    unitNumber: 'B1',
    type: 'office_suite',
    floorAreaSqm: 420,
    floor: '1',
    occupancyStatus: 'occupied',
    currentTenantId: FIXTURE_IDS.tenants.coastalLaw,
    currentLeaseId: FIXTURE_IDS.leases.coastalLaw,
  },
]

const tenants: Tenant[] = [
  {
    id: FIXTURE_IDS.tenants.pickNPay,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    legalName: 'Pick n Pay Retailers (Pty) Ltd',
    tradingName: 'Pick n Pay Soweto',
    businessType: 'pty_ltd',
    registrationNumber: '1973/004739/07',
    primaryContact: { fullName: 'Lerato Nkosi', role: 'Store Manager', phone: '+27831230001' },
    whatsappNumber: '+27831230001',
    whatsappVerified: true,
    whatsappOptedOut: false,
    status: 'active',
    industry: 'Grocery retail',
  },
  {
    id: FIXTURE_IDS.tenants.coastalLaw,
    companyId: FIXTURE_IDS.companies.atlas,
    createdAt: T0,
    updatedAt: T0,
    legalName: 'Coastal Law Chambers Inc',
    tradingName: 'Coastal Law',
    businessType: 'pty_ltd',
    primaryContact: { fullName: 'Nomvula Zulu', role: 'Practice Manager', phone: '+27831230002' },
    whatsappNumber: '+27831230002',
    whatsappVerified: false,
    whatsappOptedOut: false,
    status: 'active',
    industry: 'Legal services',
  },
]

const leases: Lease[] = [
  {
    id: FIXTURE_IDS.leases.pickNPay,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    reference: 'MSQ-L001',
    propertyId: FIXTURE_IDS.properties.soweto,
    unitId: FIXTURE_IDS.units.sowetoA1,
    tenantId: FIXTURE_IDS.tenants.pickNPay,
    commencementDate: '2024-03-01',
    expiryDate: '2029-02-28',
    initialMonthlyRental: 350_000,
    currentMonthlyRental: 408_240,
    paymentDueDay: 1,
    escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2025-03-01' },
    renewalOption: { exists: true, renewalTermMonths: 60, noticePeriodMonths: 6, exercised: false },
    deposit: { amount: 700_000, basisMonths: 2, heldBy: 'managing_agent', interestBearing: true },
    status: 'active',
    verified: true,
    verifiedByUserId: FIXTURE_IDS.users.thandi,
    verifiedAt: T0,
  },
  {
    id: FIXTURE_IDS.leases.coastalLaw,
    companyId: FIXTURE_IDS.companies.atlas,
    createdAt: T0,
    updatedAt: T0,
    reference: 'UOP-L001',
    propertyId: FIXTURE_IDS.properties.umhlanga,
    unitId: FIXTURE_IDS.units.umhlangaB1,
    tenantId: FIXTURE_IDS.tenants.coastalLaw,
    commencementDate: '2025-07-01',
    expiryDate: '2028-06-30',
    initialMonthlyRental: 84_000,
    currentMonthlyRental: 84_000,
    paymentDueDay: 1,
    escalation: { type: 'percentage', percentage: 7, frequency: 'annual', firstEscalationDate: '2026-07-01' },
    renewalOption: { exists: false, exercised: false },
    status: 'pending_verification',
    verified: false,
  },
]

const statements: Statement[] = [
  {
    id: FIXTURE_IDS.statements.pickNPayOct,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: '2026-10-02T09:00:00+02:00',
    updatedAt: '2026-10-02T09:00:00+02:00',
    propertyId: FIXTURE_IDS.properties.soweto,
    tenantId: FIXTURE_IDS.tenants.pickNPay,
    unitId: FIXTURE_IDS.units.sowetoA1,
    leaseId: FIXTURE_IDS.leases.pickNPay,
    file: {
      fileName: 'MSQ-L001-2026-10.pdf',
      storagePath: 'statements/cmp_nexus/MSQ-L001-2026-10.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 182_000,
      sha256: 'a'.repeat(64),
    },
    sourceSystem: 'MRI',
    statementNumber: 'MRI-2026-10-0001',
    statementDate: '2026-10-01',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'review_required',
    uploadedByUserId: FIXTURE_IDS.users.thandi,
    uploadedAt: '2026-10-02T09:00:00+02:00',
    extractionId: FIXTURE_IDS.extractions.pickNPayOct,
    lineItems: [],
  },
]

const statementExtractions: StatementExtraction[] = [
  {
    id: FIXTURE_IDS.extractions.pickNPayOct,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: '2026-10-02T09:01:00+02:00',
    updatedAt: '2026-10-02T09:01:00+02:00',
    statementId: FIXTURE_IDS.statements.pickNPayOct,
    engine: 'demo-ocr',
    extractedAt: '2026-10-02T09:01:00+02:00',
    overallConfidence: 0.82,
    fields: [
      { name: 'rental_charged', rawText: 'R 408 240.00', value: 408_240, confidence: 0.97, flagged: false },
      { name: 'additional_charges', rawText: 'R 61 000.00', value: 61_000, confidence: 0.9, flagged: false },
      { name: 'payments_received', rawText: 'R 400 000.00', value: 400_000, confidence: 0.55, flagged: true },
      { name: 'outstanding_balance', rawText: 'R 69 240.00', value: 69_240, confidence: 0.6, flagged: true },
      { name: 'total_due', rawText: 'R 69 240.00', value: 69_240, confidence: 0.6, flagged: true },
    ],
    matchedTenantId: FIXTURE_IDS.tenants.pickNPay,
    matchedUnitId: FIXTURE_IDS.units.sowetoA1,
    matchConfidence: 0.95,
    status: 'pending_review',
  },
]

const monitoringEvents: MonitoringEvent[] = [
  {
    id: FIXTURE_IDS.events.escalation,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: '2026-10-03T08:00:00+02:00',
    updatedAt: '2026-10-03T08:00:00+02:00',
    type: 'rental_escalation_discrepancy',
    propertyId: FIXTURE_IDS.properties.soweto,
    unitId: FIXTURE_IDS.units.sowetoA1,
    tenantId: FIXTURE_IDS.tenants.pickNPay,
    leaseId: FIXTURE_IDS.leases.pickNPay,
    leaseReference: 'MSQ-L001',
    statementId: FIXTURE_IDS.statements.pickNPayOct,
    ruleId: FIXTURE_IDS.rules.escalation,
    title: 'Rental charged below escalated amount',
    description: 'Statement rental is R 408 240.00 but the lease escalates to R 408 240.00 from 1 Mar 2026.',
    calculation: { expectedAmount: 408_240, actualAmount: 408_240, difference: 0, steps: ['R350,000 × 1.08 × 1.08 = R408,240'] },
    identifiedOn: '2026-10-03',
    priority: 'high',
    recommendedAction: 'Confirm escalation was applied by the accounting system.',
    assignedToUserId: FIXTURE_IDS.users.thandi,
    status: 'new',
  },
]

const monitoringRules: MonitoringRule[] = [
  {
    id: FIXTURE_IDS.rules.escalation,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    eventType: 'rental_escalation_discrepancy',
    name: 'Rental escalation discrepancy',
    description: 'Compare statement rental against contractual escalated rental.',
    enabled: true,
    defaultPriority: 'high',
    config: { kind: 'rental_escalation_discrepancy', toleranceRands: 50, tolerancePercent: 0.5 },
    defaultAssigneeUserId: FIXTURE_IDS.users.thandi,
  },
]

const messageTemplates: MessageTemplate[] = [
  {
    id: FIXTURE_IDS.templates.monthlyStatement,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: T0,
    updatedAt: T0,
    name: 'Monthly statement',
    messageType: 'monthly_statement',
    audience: 'tenant',
    metaTemplateName: 'nexus_monthly_statement_v1',
    language: 'en_ZA',
    category: 'utility',
    body: 'Good day {{1}}, your statement for {{2}} is attached. Amount due: R{{3}}.',
    variables: ['tenant name', 'period', 'amount due'],
    approvalStatus: 'approved',
    supportsDocumentAttachment: true,
  },
]

const notifications: Notification[] = [
  {
    id: FIXTURE_IDS.notifications.thandi,
    companyId: FIXTURE_IDS.companies.nexus,
    createdAt: '2026-10-03T08:00:00+02:00',
    updatedAt: '2026-10-03T08:00:00+02:00',
    userId: FIXTURE_IDS.users.thandi,
    type: 'monitoring_event',
    severity: 'warning',
    title: 'New escalation discrepancy',
    body: 'MSQ-L001 needs review.',
    read: false,
    link: { entityType: 'monitoring_event', entityId: FIXTURE_IDS.events.escalation },
  },
  {
    id: FIXTURE_IDS.notifications.sipho,
    companyId: FIXTURE_IDS.companies.atlas,
    createdAt: '2026-10-03T08:00:00+02:00',
    updatedAt: '2026-10-03T08:00:00+02:00',
    userId: FIXTURE_IDS.users.sipho,
    type: 'system',
    severity: 'info',
    title: 'Welcome to LeaseGuard',
    body: 'Your workspace is ready.',
    read: false,
  },
]

export function createFixtureCollections(): Collections {
  const collections: Collections = {
    ...emptyCollections(),
    companies: toRecordMap(companies),
    users: toRecordMap(users),
    properties: toRecordMap(properties),
    units: toRecordMap(units),
    tenants: toRecordMap(tenants),
    leases: toRecordMap(leases),
    statements: toRecordMap(statements),
    statementExtractions: toRecordMap(statementExtractions),
    monitoringEvents: toRecordMap(monitoringEvents),
    monitoringRules: toRecordMap(monitoringRules),
    messageTemplates: toRecordMap(messageTemplates),
    notifications: toRecordMap(notifications),
  }
  return structuredClone(collections)
}

export const FIXTURE_WORKSPACE = {
  activeCompanyId: FIXTURE_IDS.companies.nexus,
  currentUserId: FIXTURE_IDS.users.thandi,
} as const
