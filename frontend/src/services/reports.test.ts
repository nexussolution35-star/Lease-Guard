/** Reports against the REAL demo seed: every figure must equal an independent recomputation. */
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDemoSeed, DEMO_COMPANY_IDS, DEMO_REFERENCE_DATE } from '@/services/demo/seed'
import { ageArrears, guaranteeExpiryStatus, isArrangementActive, sumZar } from '@leaseguard/domain'
import { useAppStore } from '@/store/appStore'
import { REPORT_IDS } from '@leaseguard/domain'

import {
  getArrearsReport,
  getCommunicationActivityReport,
  getDashboardMetrics,
  getLeaseExpiryReport,
  getLeaseMonitoringReport,
  getOccupancyReport,
  getPaymentArrangementsReport,
  getPortfolioOverview,
  getRentalDiscrepancyReport,
  getReport,
  getStatementProcessingReport,
  REPORT_DEFINITIONS,
  useDashboardMetrics,
  useReport,
  getDepositsGuaranteesReport,
  getRenewalDeadlinesReport,
} from '@/services/reports'

const TODAY = DEMO_REFERENCE_DATE
const NEXUS = DEMO_COMPANY_IDS.nexus
const SECOND = DEMO_COMPANY_IDS.second

function seedFor(companyId: string) {
  const seed = createDemoSeed()
  const of = <T extends { companyId: string }>(m: Readonly<Record<string, T>>) => Object.values(m).filter((r) => r.companyId === companyId)
  return {
    company: seed.companies[companyId],
    properties: of(seed.properties).filter((p) => p.status !== 'archived'),
    units: of(seed.units),
    leases: of(seed.leases),
    statements: of(seed.statements),
    events: of(seed.monitoringEvents),
    arrangements: of(seed.paymentArrangements),
    approvals: of(seed.messageApprovals),
    communications: of(seed.communications),
  }
}

const OPEN = ['new', 'under_review', 'action_required', 'in_progress']

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('report definitions', () => {
  it('defines every report id once', () => {
    expect(REPORT_DEFINITIONS.map((d) => d.id).sort()).toEqual([...REPORT_IDS].sort())
    for (const id of REPORT_IDS) expect(() => getReport(id, {}, TODAY)).not.toThrow()
  })
})

describe('dashboard metrics (Nexus)', () => {
  it('match an independent recomputation from the seed', () => {
    const s = seedFor(NEXUS)
    const m = getDashboardMetrics(TODAY)
    const arrears = ageArrears(s.statements, TODAY)
    expect(m.totalProperties).toBe(s.properties.length)
    expect(m.totalUnits).toBe(s.units.filter((u) => s.properties.some((p) => p.id === u.propertyId)).length)
    expect(m.occupiedUnits).toBe(s.units.filter((u) => u.occupancyStatus === 'occupied').length)
    expect(m.activeLeases).toBe(s.leases.filter((l) => l.status === 'active' || l.status === 'expiring').length)
    expect(m.totalOutstanding).toBe(sumZar(arrears.map((a) => a.outstanding)))
    expect(m.tenantsInArrears).toBe(arrears.length)
    expect(m.escalationDiscrepancies).toBe(
      s.events.filter((e) => e.type === 'rental_escalation_discrepancy' && OPEN.includes(e.status)).length,
    )
    expect(m.activeArrangements).toBe(s.arrangements.filter((a) => isArrangementActive(a, TODAY)).length)
    expect(m.pendingStatementReviews).toBe(s.statements.filter((x) => x.status === 'review_required').length)
    expect(m.pendingApprovals).toBe(s.approvals.filter((a) => a.decision === 'pending').length)
    expect(m.expiringGuarantees).toBe(
      s.leases.filter(
        (l) =>
          (l.status === 'active' || l.status === 'expiring') &&
          l.bankGuarantee &&
          guaranteeExpiryStatus(l.bankGuarantee, TODAY, s.company.settings.guaranteeExpiryNoticeDays).state === 'expiring',
      ).length,
    )
    expect(m.totalProperties).toBeGreaterThan(0)
    expect(m.totalOutstanding).toBeGreaterThan(0)
  })

  it('changes after switching workspace', () => {
    const nexus = getDashboardMetrics(TODAY)
    useAppStore.getState().switchWorkspace(SECOND)
    const second = getDashboardMetrics(TODAY)
    const s = seedFor(SECOND)
    expect(second.totalProperties).toBe(s.properties.length)
    expect(second.totalUnits).toBe(s.units.length)
    expect(second).not.toEqual(nexus)
  })

  it('hook reacts to store mutations and workspace switches', () => {
    const { result } = renderHook(() => useDashboardMetrics(TODAY))
    const before = result.current.totalProperties
    act(() => useAppStore.getState().switchWorkspace(SECOND))
    expect(result.current.totalProperties).toBe(seedFor(SECOND).properties.length)
    expect(result.current.totalProperties).not.toBe(before)
  })
})

describe('reports (Nexus)', () => {
  it('portfolio overview totals agree with per-property rows', () => {
    const s = seedFor(NEXUS)
    const r = getPortfolioOverview({}, TODAY)
    expect(r.propertyCount).toBe(s.properties.length)
    expect(r.unitCount).toBe(sumZar(r.properties.map((p) => p.unitCount)))
    expect(r.totalOutstanding).toBe(sumZar(r.properties.map((p) => p.outstanding)))
    expect(r.monthlyRentalRoll).toBe(
      sumZar(s.leases.filter((l) => l.status === 'active' || l.status === 'expiring').map((l) => l.currentMonthlyRental)),
    )
  })

  it('property filter narrows every figure', () => {
    const s = seedFor(NEXUS)
    const propertyId = s.properties[0].id
    const r = getPortfolioOverview({ propertyIds: [propertyId] }, TODAY)
    expect(r.propertyCount).toBe(1)
    expect(r.unitCount).toBe(s.units.filter((u) => u.propertyId === propertyId).length)
    const occ = getOccupancyReport({ propertyIds: [propertyId] }, TODAY)
    expect(occ.totals.total).toBe(r.unitCount)
    expect(sumZar(occ.byUnitType.map((t) => t.total))).toBe(occ.totals.total)
  })

  it('arrears buckets sum to the total and use verified statements only', () => {
    const s = seedFor(NEXUS)
    const r = getArrearsReport({}, TODAY)
    expect(sumZar(r.buckets.map((b) => b.amount))).toBe(r.totalOutstanding)
    expect(r.tenantCount).toBe(ageArrears(s.statements, TODAY).length)
    const verified = new Set(s.statements.filter((x) => x.status === 'verified').map((x) => x.id))
    for (const row of r.rows) expect(verified.has(row.statementId)).toBe(true)
  })

  it('lease monitoring counts match open events', () => {
    const s = seedFor(NEXUS)
    const r = getLeaseMonitoringReport({}, TODAY)
    expect(r.total).toBe(s.events.length)
    expect(r.open).toBe(s.events.filter((e) => OPEN.includes(e.status)).length)
    expect(Object.values(r.byType).reduce((a, b) => a + b, 0)).toBe(r.open)
    const filtered = getLeaseMonitoringReport({ statuses: ['resolved'] }, TODAY)
    expect(filtered.total).toBe(s.events.filter((e) => e.status === 'resolved').length)
  })

  it('rental discrepancies include raised events and only recompute verified leases', () => {
    const s = seedFor(NEXUS)
    const r = getRentalDiscrepancyReport({}, TODAY)
    const raised = s.events.filter((e) => e.type === 'rental_escalation_discrepancy' && e.calculation?.expectedAmount !== undefined)
    expect(r.eventCount).toBe(raised.length)
    const verifiedLeaseIds = new Set(s.leases.filter((l) => l.verified).map((l) => l.id))
    for (const row of r.rows.filter((x) => x.source === 'recomputed')) expect(verifiedLeaseIds.has(row.leaseId)).toBe(true)
    expect(r.unverifiedLeasesExcluded).toBe(
      s.leases.filter((l) => (l.status === 'active' || l.status === 'expiring') && !l.verified).length,
    )
  })

  it('lease expiry buckets cover every monitored unexpired lease', () => {
    const s = seedFor(NEXUS)
    const r = getLeaseExpiryReport({}, TODAY)
    const monitored = s.leases.filter((l) => (l.status === 'active' || l.status === 'expiring'))
    expect(r.buckets.reduce((a, b) => a + b.count, 0) + r.expiredCount).toBe(monitored.length)
  })

  it('renewal, security, arrangements, statements and communications reports are consistent', () => {
    const s = seedFor(NEXUS)
    const renewal = getRenewalDeadlinesReport({}, TODAY)
    expect(Object.values(renewal.countsByStatus).reduce((a, b) => a + b, 0)).toBe(renewal.rows.length)
    const security = getDepositsGuaranteesReport({}, TODAY)
    expect(security.depositShortfallTotal).toBe(sumZar(security.rows.map((x) => x.depositShortfall)))
    const arr = getPaymentArrangementsReport({}, TODAY)
    expect(Object.values(arr.countsByStatus).reduce((a, b) => a + b, 0)).toBe(s.arrangements.length)
    expect(arr.activeCount).toBe(s.arrangements.filter((a) => isArrangementActive(a, TODAY)).length)
    const st = getStatementProcessingReport({}, TODAY)
    expect(st.total).toBe(s.statements.length)
    expect(st.duplicates.length).toBe(s.statements.filter((x) => x.status === 'duplicate').length)
    const comms = getCommunicationActivityReport({}, TODAY)
    expect(comms.total).toBe(s.communications.length)
    expect(comms.failed.length).toBe(s.communications.filter((c) => c.status === 'failed').length)
    expect(comms.approvals.pending).toBe(s.approvals.filter((a) => a.decision === 'pending').length)
  })

  it('useReport recomputes after workspace switch', () => {
    const { result } = renderHook(() => useReport('statement_processing', {}, TODAY))
    expect(result.current.total).toBe(seedFor(NEXUS).statements.length)
    act(() => useAppStore.getState().switchWorkspace(SECOND))
    expect(result.current.total).toBe(seedFor(SECOND).statements.length)
  })
})
