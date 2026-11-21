import { describe, expect, it } from 'vitest'

import type { MessageTypeTemplateMapping } from '../types/index.js'
import { buildArrearsReport, type ArrearsReportAccount, type ReportArrangement } from './arrearsReports.js'
import { containsBankDetails } from './messageContent.js'
import type { MonitoringReportEvent, RentalComparisonLease } from './monitoringReports.js'
import {
  buildOwnerWeeklySummary,
  isOwnerSummaryDay,
  nextOwnerSummaryDate,
  outstandingChangeText,
  ownerSummaryCompanyBlockers,
  ownerSummaryDeliveryJobId,
  ownerSummaryLine,
  ownerSummaryMessage,
  ownerSummaryRecipientBlockers,
  ownerSummaryTemplateProblems,
  ownerSummaryTemplateValues,
  ownerSummaryWeekStart,
  weekdayOf,
  type OwnerSummarySources,
} from './ownerWeeklySummary.js'
import type { LeaseSecurityRecord } from './securityReports.js'

const AS_OF = '2026-11-23' // a Monday
const OWNER = { userId: 'owner-1', name: 'Thandi Owner' }
const MINE = [
  { propertyId: 'p1', propertyName: 'Maponya Square' },
  { propertyId: 'p2', propertyName: 'Brooklyn Mall' },
]

const account = (patch: Partial<ArrearsReportAccount> & Pick<ArrearsReportAccount, 'tenantId' | 'propertyId' | 'outstanding'>): ArrearsReportAccount => ({
  tenantName: `Tenant ${patch.tenantId}`,
  propertyName: patch.propertyId,
  statementId: `${patch.tenantId}-st`,
  statementDate: '2026-11-01',
  ...patch,
})

const event = (patch: Partial<MonitoringReportEvent> & Pick<MonitoringReportEvent, 'eventId'>): MonitoringReportEvent => ({
  type: 'lease_expiry',
  title: `Event ${patch.eventId}`,
  priority: 'medium',
  status: 'new',
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  identifiedOn: '2026-11-10',
  ...patch,
})

const security = (patch: Partial<LeaseSecurityRecord> & Pick<LeaseSecurityRecord, 'leaseId'>): LeaseSecurityRecord => ({
  reference: patch.leaseId.toUpperCase(),
  status: 'active',
  verified: true,
  tenantId: `${patch.leaseId}-tenant`,
  tenantName: `Tenant ${patch.leaseId}`,
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  unitId: `${patch.leaseId}-unit`,
  unitNumber: 'S01',
  commencementDate: '2025-03-01',
  expiryDate: '2029-02-28',
  initialMonthlyRental: 35_000,
  escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2026-03-01' },
  ...patch,
})

const comparison = (patch: Partial<RentalComparisonLease> & Pick<RentalComparisonLease, 'leaseId'>): RentalComparisonLease => ({
  reference: patch.leaseId.toUpperCase(),
  status: 'active',
  verified: true,
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  tenantId: `${patch.leaseId}-tenant`,
  tenantName: `Tenant ${patch.leaseId}`,
  commencementDate: '2025-03-01',
  expiryDate: '2029-02-28',
  initialMonthlyRental: 35_000,
  escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2026-03-01' },
  ...patch,
})

const arrangement: ReportArrangement = {
  arrangementId: 'arr-1',
  tenantId: 't2',
  tenantName: 'Tenant t2',
  propertyId: 'p2',
  propertyName: 'Brooklyn Mall',
  unitId: 'u2',
  unitNumber: 'B02',
  leaseId: 'l2',
  leaseReference: 'L2',
  status: 'active',
  frequency: 'monthly',
  installmentAmount: 1_000,
  outstandingBalance: 3_000,
  firstInstallmentDate: '2026-09-01',
  finalInstallmentDate: '2026-11-01',
  agreedOn: '2026-08-20',
  suppressArrearsReminders: true,
  installments: [
    { id: 'i1', arrangementId: 'arr-1', sequence: 1, dueDate: '2026-09-01', amount: 1_000, status: 'confirmed_paid' },
    { id: 'i2', arrangementId: 'arr-1', sequence: 2, dueDate: '2026-10-01', amount: 1_000, status: 'missed' },
    { id: 'i3', arrangementId: 'arr-1', sequence: 3, dueDate: '2026-11-01', amount: 1_000, status: 'scheduled' },
  ],
}

const SOURCES: OwnerSummarySources = {
  accounts: [
    account({ tenantId: 't1', propertyId: 'p1', outstanding: 12_000 }),
    account({ tenantId: 't2', propertyId: 'p2', outstanding: 3_000 }),
    // Another owner's property: never in this owner's summary.
    account({ tenantId: 't9', propertyId: 'p9', outstanding: 99_000 }),
  ],
  arrangements: [arrangement],
  events: [
    event({ eventId: 'e-critical', priority: 'critical', title: 'Escalation not applied' }),
    event({ eventId: 'e-overdue', dueDate: '2026-11-20', status: 'action_required', title: 'Renewal notice' }),
    event({ eventId: 'e-low', priority: 'low' }),
    event({ eventId: 'e-closed', priority: 'critical', status: 'resolved' }),
    event({ eventId: 'e-other', priority: 'critical', propertyId: 'p9', propertyName: 'Elsewhere' }),
  ],
  rentalComparisons: [
    // R37 800 expected after the March 2026 escalation; billed at the old rental.
    comparison({ leaseId: 'l1', billed: { statementId: 's1', statementDate: '2026-11-01', periodStart: '2026-11-01', rentalCharged: 35_000 } }),
    comparison({ leaseId: 'l3', billed: { statementId: 's3', statementDate: '2026-11-01', periodStart: '2026-11-01', rentalCharged: 37_800 } }),
    comparison({ leaseId: 'l-unverified', verified: false, status: 'pending_verification', billed: { statementId: 's4', statementDate: '2026-11-01', periodStart: '2026-11-01', rentalCharged: 1 } }),
  ],
  security: [
    security({ leaseId: 'g-expiring', bankGuarantee: { bank: 'Standard Bank', referenceNumber: 'BG-1', amount: 120_000, basisMonths: 3, issuedOn: '2025-03-01', expiresOn: '2026-12-10', status: 'active' } }),
    security({ leaseId: 'g-expired', bankGuarantee: { bank: 'Absa', referenceNumber: 'BG-2', amount: 120_000, basisMonths: 3, issuedOn: '2025-03-01', expiresOn: '2026-11-01', status: 'active' } }),
  ],
  guaranteeNoticeDays: [90, 30],
}

const build = (previous?: { weekStart: string; totalOutstanding: number } | null) =>
  buildOwnerWeeklySummary({ owner: OWNER, properties: MINE, asOf: AS_OF, previous: previous ?? null, sources: SOURCES })

describe('owner summary weeks', () => {
  it('takes the Monday of the week', () => {
    expect(ownerSummaryWeekStart('2026-11-23')).toBe('2026-11-23')
    expect(ownerSummaryWeekStart('2026-11-29')).toBe('2026-11-23')
    expect(ownerSummaryWeekStart('2026-11-22')).toBe('2026-11-16')
  })

  it('knows the company’s day and the next one', () => {
    expect(weekdayOf('2026-11-23')).toBe('monday')
    expect(isOwnerSummaryDay('2026-11-23', 'monday')).toBe(true)
    expect(isOwnerSummaryDay('2026-11-24', 'monday')).toBe(false)
    expect(nextOwnerSummaryDate('2026-11-23', 'monday')).toBe('2026-11-23')
    expect(nextOwnerSummaryDate('2026-11-24', 'monday')).toBe('2026-11-30')
    expect(nextOwnerSummaryDate('2026-11-24', 'friday')).toBe('2026-11-27')
  })
})

describe('buildOwnerWeeklySummary', () => {
  it('totals the outstanding at the owner’s properties only, as the arrears report does', () => {
    const summary = build()
    const arrears = buildArrearsReport({ accounts: SOURCES.accounts, arrangements: SOURCES.arrangements, asOf: AS_OF, filters: { propertyIds: ['p1', 'p2'] } })
    expect(summary.totalOutstanding).toBe(15_000)
    expect(summary.totalOutstanding).toBe(arrears.totalOutstanding)
    expect(summary.tenantsInArrears).toBe(2)
    expect(summary.outstandingUnderArrangement).toBe(3_000)
    expect(summary.properties.map((p) => p.propertyName)).toEqual(['Brooklyn Mall', 'Maponya Square'])
    expect(summary.weekStart).toBe('2026-11-23')
  })

  it('states the change since the previous stored summary, and none on the first', () => {
    expect(build().outstandingChange).toBeNull()
    expect(outstandingChangeText(build())).toBe('first weekly summary')
    const up = build({ weekStart: '2026-11-16', totalOutstanding: 13_000 })
    expect(up.outstandingChange).toBe(2_000)
    expect(outstandingChangeText(up)).toBe('up R 2 000,00 since 16 Nov 2026')
    expect(outstandingChangeText(build({ weekStart: '2026-11-16', totalOutstanding: 20_000 }))).toBe('down R 5 000,00 since 16 Nov 2026')
    expect(outstandingChangeText(build({ weekStart: '2026-11-16', totalOutstanding: 15_000 }))).toBe('unchanged since 16 Nov 2026')
  })

  it('lists open critical, high or overdue events at the owner’s properties', () => {
    const summary = build()
    expect(summary.importantEvents.map((e) => e.eventId).sort()).toEqual(['e-critical', 'e-overdue'])
    expect(summary.openEventCount).toBe(3)
  })

  it('lists current rental discrepancies outside tolerance on verified leases only', () => {
    const summary = build()
    expect(summary.discrepancies).toEqual([expect.objectContaining({ leaseId: 'l1', expected: 37_800, billed: 35_000, difference: 2_800 })])
    expect(summary.discrepancyMonthlyDifference).toBe(2_800)
  })

  it('lists guarantees in force inside the notice days', () => {
    expect(build().expiringGuarantees).toEqual([expect.objectContaining({ leaseId: 'g-expiring', expiresOn: '2026-12-10', daysUntilExpiry: 17, guaranteeBank: 'Standard Bank' })])
  })

  it('collects the items that need the owner’s attention, each with its record', () => {
    const kinds = build().attention.map((item) => [item.kind, item.record.id])
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['overdue_event', 'e-overdue'],
        ['arrangement_instalments', 'arr-1'],
        ['guarantee_expired', 'g-expired'],
      ]),
    )
    expect(build().attention.find((item) => item.kind === 'arrangement_instalments')?.title).toContain('1 instalment missed')
  })

  it('never reads the whole company for an owner without properties', () => {
    const summary = buildOwnerWeeklySummary({ owner: OWNER, properties: [], asOf: AS_OF, sources: SOURCES })
    expect(summary.totalOutstanding).toBe(0)
    expect(summary.importantEvents).toEqual([])
  })
})

describe('the WhatsApp text', () => {
  const summary = build({ weekStart: '2026-11-16', totalOutstanding: 13_000 })

  it('fills the template’s three placeholders with one line and no bank details', () => {
    const values = ownerSummaryTemplateValues(summary)
    expect(values[0]).toBe('Thandi Owner')
    expect(values[1]).toBe('23 Nov 2026')
    expect(values[2]).toBe(ownerSummaryLine(summary))
    expect(values[2]).toBe(
      'Outstanding R 15 000,00 (up R 2 000,00 since 16 Nov 2026); 2 important monitoring events; 1 rental discrepancy; 1 guarantee expiring; 3 items need your attention',
    )
    expect(values[2]).not.toMatch(/[\n\t]/)
    expect(containsBankDetails(values.join(' '))).toBe(false)
    expect(ownerSummaryMessage('Hi {{1}}, your summary for the week of {{2}}: {{3}}.', values)).toBe(`Hi Thandi Owner, your summary for the week of 23 Nov 2026: ${values[2]}.`)
  })

  it('refuses a template that needs more than three values', () => {
    expect(ownerSummaryTemplateProblems('{{1}} {{2}} {{3}}')).toEqual([])
    expect(ownerSummaryTemplateProblems('{{1}} {{4}}')[0]).toContain('{{4}}')
  })
})

describe('who and when it may be sent', () => {
  const mapping: MessageTypeTemplateMapping = {
    templateId: 'tpl',
    metaTemplateName: 'owner_weekly',
    language: 'en_ZA',
    category: 'utility',
    body: 'Hi {{1}}, week of {{2}}: {{3}}',
    variables: ['Owner name', 'Week', 'Summary'],
    approvalStatus: 'approved',
    metaStatus: 'APPROVED',
    supportsDocumentAttachment: false,
    metaBodyChanged: false,
    mappedAt: '2026-11-20T08:00:00Z',
  }

  it('needs an approved template and a connected number', () => {
    expect(ownerSummaryCompanyBlockers({ mapping, whatsappConnected: true })).toEqual([])
    expect(ownerSummaryCompanyBlockers({ whatsappConnected: true })[0]).toContain('No template chosen')
    expect(ownerSummaryCompanyBlockers({ mapping: { ...mapping, approvalStatus: 'submitted' }, whatsappConnected: true })[0]).toContain('Meta is reviewing')
    expect(ownerSummaryCompanyBlockers({ mapping, whatsappConnected: false })).toEqual([expect.stringContaining('No WhatsApp number is connected')])
    expect(ownerSummaryCompanyBlockers({ mapping: { ...mapping, body: '{{1}} {{5}}' }, whatsappConnected: true })[0]).toContain('{{5}}')
  })

  it('goes to an active property owner with a WhatsApp number only', () => {
    const values = ownerSummaryTemplateValues(build())
    expect(ownerSummaryRecipientBlockers('c1', { status: 'active', whatsappNumber: '+27820000001', role: 'property_owner' }, values)).toEqual([])
    expect(ownerSummaryRecipientBlockers('c1', { status: 'active', role: 'property_owner' }, values)).toEqual(['Owner has no WhatsApp number on record'])
    expect(ownerSummaryRecipientBlockers('c1', { status: 'suspended', whatsappNumber: '+27820000001', role: 'property_owner' }, values)).toEqual(['Owner user is suspended'])
    expect(ownerSummaryRecipientBlockers('c1', { status: 'active', whatsappNumber: '+27820000001', role: 'property_manager' }, values)).toEqual([
      'User is not a property owner in this company',
    ])
  })
})

describe('ownerSummaryDeliveryJobId', () => {
  it('names one job per stored summary, by the core\u2019s job id convention', () => {
    expect(ownerSummaryDeliveryJobId({ companyId: 'ABC', summaryId: 'Def' })).toBe('owner-summary-delivery.abc.def')
  })
})

describe('reportCatalogueFor', () => {
  it('lists the weekly owner summary for company admins only', async () => {
    const { reportCatalogueFor } = await import('./reportCatalogue.js')
    expect(reportCatalogueFor('company_admin').map((r) => r.id)).toContain('owner_weekly_summary')
    for (const role of ['property_manager', 'property_owner', 'read_only'] as const) {
      expect(reportCatalogueFor(role).map((r) => r.id)).not.toContain('owner_weekly_summary')
    }
  })
})
