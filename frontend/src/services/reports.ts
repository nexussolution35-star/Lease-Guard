import { useMemo } from 'react'

import {
  ageArrears,
  ageingBucketLabels,
  arrangementProgress,
  compareBilledRental,
  daysUntilExpiry,
  DEFAULT_AGEING_BUCKETS,
  depositCoverage,
  guaranteeCoverage,
  guaranteeExpiryStatus,
  isArrangementActive,
  leasesRequiringRenewalWarning,
  MONITORED_LEASE_STATUSES,
  nextInstallment,
  overdueInstallments,
  renewalDeadlineStatus,
  renewalNoticeDeadline,
  roundZar,
  shouldSuppressArrearsReminder,
  sumZar,
  totalOutstanding,
  upcomingExpiries,
  daysBetween,
} from '@leaseguard/domain'
import { todayISO } from '@/store/ids'
import {
  ARRANGEMENT_STATUSES,
  DELIVERY_STATUSES,
  EVENT_PRIORITIES,
  EXPIRY_BUCKETS,
  MESSAGE_TYPES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  STATEMENT_SOURCES,
  STATEMENT_STATUSES,
  UNIT_TYPES,
  type ArrearsReport,
  type ArrearsRow,
  type CommunicationActivityReport,
  type Communication,
  type DashboardMetrics,
  type DepositsGuaranteesReport,
  type EntityId,
  type ExpiryBucket,
  type ISODate,
  type Lease,
  type LeaseExpiryReport,
  type LeaseMonitoringReport,
  type MonitoringRuleConfig,
  type OccupancyFigures,
  type OccupancyReport,
  type PaymentArrangementsReport,
  type PortfolioOverviewReport,
  type RenewalDeadlinesReport,
  type RentalDiscrepancyReport,
  type RentalDiscrepancyRow,
  type ReportDefinition,
  type ReportFilters,
  type ReportId,
  type ReportResultMap,
  type StatementProcessingReport,
  type Unit,
} from '@leaseguard/domain'

import { OPEN_EVENT_STATUSES } from '@/services/monitoring'
import { computePropertyStats } from '@/services/properties'
import { getScopedData, indexById, useScopedData, type ScopedData } from '@/services/snapshot'

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  { id: 'portfolio_overview', title: 'Portfolio overview', description: 'Properties, occupancy, rental roll and outstanding balances per property.', icon: 'building-2' },
  { id: 'occupancy', title: 'Occupancy', description: 'Occupied, vacant and under-offer units by property and unit type.', icon: 'door-open' },
  { id: 'lease_monitoring', title: 'Lease monitoring', description: 'Monitoring events by type, priority and status.', icon: 'activity' },
  { id: 'rental_discrepancies', title: 'Rental discrepancies', description: 'Billed rental versus escalated contractual rental on verified leases.', icon: 'trending-up' },
  { id: 'lease_expiry', title: 'Lease expiry', description: 'Leases expiring in 0–30, 31–90, 91–180, 181–365 and 365+ days.', icon: 'calendar-clock' },
  { id: 'renewal_deadlines', title: 'Renewal deadlines', description: 'Renewal option notice deadlines and their urgency.', icon: 'calendar-check' },
  { id: 'deposits_guarantees', title: 'Deposits and guarantees', description: 'Security coverage, shortfalls and expiring bank guarantees.', icon: 'shield-check' },
  { id: 'arrears', title: 'Arrears ageing', description: 'Outstanding balances from verified statements, aged by bucket.', icon: 'wallet' },
  { id: 'payment_arrangements', title: 'Payment arrangements', description: 'Arrangement status, balance under arrangement and missed instalments.', icon: 'handshake' },
  { id: 'statement_processing', title: 'Statement processing', description: 'Statement statuses, extraction confidence and duplicates.', icon: 'file-text' },
  { id: 'communication_activity', title: 'Communication activity', description: 'WhatsApp messages by type and status, and approval turnaround.', icon: 'message-square' },
]

export function getReportDefinition(id: ReportId): ReportDefinition {
  const def = REPORT_DEFINITIONS.find((d) => d.id === id)
  if (!def) throw new Error(`Unknown report ${id}`)
  return def
}

// ---------------------------------------------------------------------------------- helpers

interface FilterFns {
  inProperty(propertyId: EntityId | undefined): boolean
  inRange(date: ISODate | undefined): boolean
  hasStatus(status: string): boolean
}

function filterFns(filters: ReportFilters = {}): FilterFns {
  const props = filters.propertyIds && filters.propertyIds.length > 0 ? new Set(filters.propertyIds) : null
  const statuses = filters.statuses && filters.statuses.length > 0 ? new Set(filters.statuses) : null
  return {
    inProperty: (id) => props === null || (id !== undefined && props.has(id)),
    inRange: (date) => {
      if (!filters.from && !filters.to) return true
      if (!date) return false
      return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
    },
    hasStatus: (s) => statuses === null || statuses.has(s),
  }
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
}

function ruleConfig<K extends MonitoringRuleConfig['kind']>(
  data: ScopedData,
  kind: K,
): Extract<MonitoringRuleConfig, { kind: K }> | undefined {
  const rule = data.rules.find((r) => r.config.kind === kind)
  return rule?.config as Extract<MonitoringRuleConfig, { kind: K }> | undefined
}

function arrearsBuckets(data: ScopedData): readonly number[] {
  return ruleConfig(data, 'arrears')?.ageingBucketsDays ?? DEFAULT_AGEING_BUCKETS
}

const isMonitored = (lease: Pick<Lease, 'status'>): boolean => MONITORED_LEASE_STATUSES.includes(lease.status)

function names(data: ScopedData) {
  const tenants = indexById(data.tenants)
  const properties = indexById(data.properties)
  const units = indexById(data.units)
  return {
    tenant: (id: EntityId | undefined) => (id ? (tenants.get(id)?.tradingName ?? id) : ''),
    property: (id: EntityId | undefined) => (id ? (properties.get(id)?.name ?? id) : ''),
    unit: (id: EntityId | undefined) => (id ? (units.get(id)?.unitNumber ?? id) : ''),
  }
}

function activeProperties(data: ScopedData, f: FilterFns) {
  return data.properties.filter((p) => p.status !== 'archived' && f.inProperty(p.id))
}

// ---------------------------------------------------------------------------------- reports

export function computePortfolioOverview(data: ScopedData, filters: ReportFilters = {}, today: ISODate): PortfolioOverviewReport {
  const f = filterFns(filters)
  const properties = activeProperties(data, f)
  const propertyIds = new Set(properties.map((p) => p.id))
  const units = data.units.filter((u) => propertyIds.has(u.propertyId))
  const leases = data.leases.filter((l) => propertyIds.has(l.propertyId))
  const arrears = ageArrears(data.statements.filter((s) => propertyIds.has(s.propertyId)), today, arrearsBuckets(data))
  const openEvents = data.events.filter((e) => propertyIds.has(e.propertyId) && OPEN_EVENT_STATUSES.includes(e.status))

  const rows = properties.map((p) => {
    const stats = computePropertyStats(p.id, units, leases)
    return {
      propertyId: p.id,
      propertyName: p.name,
      code: p.code,
      unitCount: stats.unitCount,
      occupiedUnits: stats.occupiedCount,
      occupancyRate: stats.occupancyRate,
      activeLeases: stats.activeLeaseCount,
      monthlyRentalRoll: stats.monthlyRentalRoll,
      outstanding: totalOutstanding(arrears.filter((a) => a.propertyId === p.id)),
      openEvents: openEvents.filter((e) => e.propertyId === p.id).length,
    }
  })
  const occupied = units.filter((u) => u.occupancyStatus === 'occupied').length
  return {
    propertyCount: properties.length,
    unitCount: units.length,
    occupiedUnits: occupied,
    vacantUnits: units.filter((u) => u.occupancyStatus === 'vacant').length,
    occupancyRate: units.length === 0 ? 0 : occupied / units.length,
    activeLeases: leases.filter(isMonitored).length,
    unverifiedLeases: leases.filter((l) => isMonitored(l) && !l.verified).length,
    monthlyRentalRoll: sumZar(rows.map((r) => r.monthlyRentalRoll)),
    totalOutstanding: totalOutstanding(arrears),
    tenantsInArrears: arrears.length,
    openEvents: openEvents.length,
    properties: rows,
  }
}

function occupancyFigures(units: readonly Unit[]): OccupancyFigures {
  const occupiedUnits = units.filter((u) => u.occupancyStatus === 'occupied')
  return {
    total: units.length,
    occupied: occupiedUnits.length,
    vacant: units.filter((u) => u.occupancyStatus === 'vacant').length,
    underOffer: units.filter((u) => u.occupancyStatus === 'under_offer').length,
    unavailable: units.filter((u) => u.occupancyStatus === 'unavailable').length,
    occupancyRate: units.length === 0 ? 0 : occupiedUnits.length / units.length,
    floorAreaSqm: units.reduce((s, u) => s + u.floorAreaSqm, 0),
    occupiedAreaSqm: occupiedUnits.reduce((s, u) => s + u.floorAreaSqm, 0),
  }
}

export function computeOccupancy(data: ScopedData, filters: ReportFilters = {}): OccupancyReport {
  const f = filterFns(filters)
  const properties = activeProperties(data, f)
  const propertyIds = new Set(properties.map((p) => p.id))
  const units = data.units.filter((u) => propertyIds.has(u.propertyId) && f.hasStatus(u.occupancyStatus))
  return {
    totals: occupancyFigures(units),
    byProperty: properties.map((p) => ({
      propertyId: p.id,
      propertyName: p.name,
      ...occupancyFigures(units.filter((u) => u.propertyId === p.id)),
    })),
    byUnitType: UNIT_TYPES.map((unitType) => ({ unitType, ...occupancyFigures(units.filter((u) => u.type === unitType)) })).filter(
      (r) => r.total > 0,
    ),
  }
}

export function computeLeaseMonitoring(data: ScopedData, filters: ReportFilters = {}): LeaseMonitoringReport {
  const f = filterFns(filters)
  const n = names(data)
  const events = data.events.filter((e) => f.inProperty(e.propertyId) && f.inRange(e.identifiedOn) && f.hasStatus(e.status))
  const byType = zeroCounts(MONITORING_EVENT_TYPES)
  const byPriority = zeroCounts(EVENT_PRIORITIES)
  const byStatus = zeroCounts(MONITORING_EVENT_STATUSES)
  for (const e of events) {
    byStatus[e.status] += 1
    if (!OPEN_EVENT_STATUSES.includes(e.status)) continue
    byType[e.type] += 1
    byPriority[e.priority] += 1
  }
  return {
    total: events.length,
    open: events.filter((e) => OPEN_EVENT_STATUSES.includes(e.status)).length,
    byType,
    byPriority,
    byStatus,
    events: events
      .map((e) => ({
        eventId: e.id,
        type: e.type,
        title: e.title,
        priority: e.priority,
        status: e.status,
        propertyId: e.propertyId,
        propertyName: n.property(e.propertyId),
        ...(e.tenantId ? { tenantName: n.tenant(e.tenantId) } : {}),
        ...(e.leaseReference ? { leaseReference: e.leaseReference } : {}),
        identifiedOn: e.identifiedOn,
        ...(e.dueDate ? { dueDate: e.dueDate } : {}),
      }))
      .sort((a, b) => b.identifiedOn.localeCompare(a.identifiedOn)),
  }
}

export function computeRentalDiscrepancies(data: ScopedData, filters: ReportFilters = {}): RentalDiscrepancyReport {
  const f = filterFns(filters)
  const n = names(data)
  const leases = indexById(data.leases)
  const rows: RentalDiscrepancyRow[] = []

  for (const e of data.events) {
    if (e.type !== 'rental_escalation_discrepancy' || !e.leaseId || !e.calculation) continue
    if (!f.inProperty(e.propertyId) || !f.inRange(e.identifiedOn) || !f.hasStatus(e.status)) continue
    const calc = e.calculation
    if (calc.expectedAmount === undefined || calc.actualAmount === undefined) continue
    const lease = leases.get(e.leaseId)
    rows.push({
      source: 'event',
      eventId: e.id,
      eventStatus: e.status,
      leaseId: e.leaseId,
      leaseReference: e.leaseReference ?? lease?.reference ?? e.leaseId,
      tenantId: e.tenantId ?? lease?.tenantId ?? '',
      tenantName: n.tenant(e.tenantId ?? lease?.tenantId),
      propertyName: n.property(e.propertyId),
      ...(e.statementId ? { statementId: e.statementId } : {}),
      expected: calc.expectedAmount,
      billed: calc.actualAmount,
      difference: calc.difference ?? roundZar(calc.expectedAmount - calc.actualAmount),
      withinTolerance: false,
      steps: calc.steps,
    })
  }

  const tolerance = ruleConfig(data, 'rental_escalation_discrepancy') ?? { toleranceRands: 0, tolerancePercent: 0 }
  const covered = new Set(rows.map((r) => `${r.leaseId}|${r.statementId ?? ''}`))
  const monitored = data.leases.filter((l) => isMonitored(l) && f.inProperty(l.propertyId))
  let recomputedCount = 0
  for (const lease of monitored) {
    if (!lease.verified) continue
    const latest = data.statements
      .filter((s) => s.leaseId === lease.id && s.status === 'verified' && s.rentalCharged !== undefined && f.inRange(s.statementDate))
      .sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0]
    if (!latest || latest.rentalCharged === undefined) continue
    if (covered.has(`${lease.id}|${latest.id}`)) continue
    const cmp = compareBilledRental(lease, latest.rentalCharged, latest.periodStart, tolerance)
    if (cmp.withinTolerance) continue
    recomputedCount += 1
    rows.push({
      source: 'recomputed',
      leaseId: lease.id,
      leaseReference: lease.reference,
      tenantId: lease.tenantId,
      tenantName: n.tenant(lease.tenantId),
      propertyName: n.property(lease.propertyId),
      statementId: latest.id,
      expected: cmp.expected,
      billed: cmp.billed,
      difference: cmp.difference,
      withinTolerance: false,
      steps: cmp.calculation.steps,
    })
  }

  const counted = rows.filter((r) => r.source === 'recomputed' || (r.eventStatus && OPEN_EVENT_STATUSES.includes(r.eventStatus)))
  return {
    rows,
    totalMonthlyDifference: sumZar(counted.map((r) => r.difference)),
    eventCount: rows.length - recomputedCount,
    recomputedCount,
    unverifiedLeasesExcluded: monitored.filter((l) => !l.verified).length,
  }
}

export function expiryBucket(days: number): ExpiryBucket {
  if (days <= 30) return '0-30'
  if (days <= 90) return '31-90'
  if (days <= 180) return '91-180'
  if (days <= 365) return '181-365'
  return '365+'
}

export function computeLeaseExpiry(data: ScopedData, filters: ReportFilters = {}, today: ISODate): LeaseExpiryReport {
  const f = filterFns(filters)
  const n = names(data)
  const leases = data.leases.filter(
    (l) => isMonitored(l) && f.inProperty(l.propertyId) && f.inRange(l.expiryDate) && f.hasStatus(l.status),
  )
  let expiredCount = 0
  const rows: LeaseExpiryReport['rows'] = []
  for (const l of leases) {
    const days = daysUntilExpiry(l, today)
    if (days < 0) {
      expiredCount += 1
      continue
    }
    rows.push({
      leaseId: l.id,
      reference: l.reference,
      tenantName: n.tenant(l.tenantId),
      propertyName: n.property(l.propertyId),
      unitNumber: n.unit(l.unitId),
      expiryDate: l.expiryDate,
      daysUntilExpiry: days,
      bucket: expiryBucket(days),
      monthlyRental: l.currentMonthlyRental,
      renewalOptionAvailable: l.renewalOption.exists && !l.renewalOption.exercised,
    })
  }
  rows.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  return {
    buckets: EXPIRY_BUCKETS.map((bucket) => {
      const inBucket = rows.filter((r) => r.bucket === bucket)
      return { bucket, count: inBucket.length, monthlyRental: sumZar(inBucket.map((r) => r.monthlyRental)) }
    }),
    rows,
    expiredCount,
  }
}

export function computeRenewalDeadlines(data: ScopedData, filters: ReportFilters = {}, today: ISODate): RenewalDeadlinesReport {
  const f = filterFns(filters)
  const n = names(data)
  const leases = data.leases.filter((l) => isMonitored(l) && f.inProperty(l.propertyId))
  const rows: RenewalDeadlinesReport['rows'] = []
  for (const l of leases) {
    const deadline = renewalNoticeDeadline(l)
    if (deadline === null || !f.inRange(deadline)) continue
    const status = renewalDeadlineStatus(l, today)
    if (!f.hasStatus(status)) continue
    rows.push({
      leaseId: l.id,
      reference: l.reference,
      tenantName: n.tenant(l.tenantId),
      propertyName: n.property(l.propertyId),
      expiryDate: l.expiryDate,
      noticePeriodMonths: l.renewalOption.noticePeriodMonths ?? 0,
      deadline,
      daysUntilDeadline: daysBetween(today, deadline),
      status,
    })
  }
  rows.sort((a, b) => a.deadline.localeCompare(b.deadline))
  const countsByStatus: Record<string, number> = {}
  for (const r of rows) countsByStatus[r.status] = (countsByStatus[r.status] ?? 0) + 1
  const warningDays = data.company?.settings.renewalDeadlineWarningDays ?? []
  const rowIds = new Set(rows.map((r) => r.leaseId))
  return {
    rows,
    countsByStatus,
    requiringWarning: leasesRequiringRenewalWarning(leases, today, warningDays).filter((w) => rowIds.has(w.lease.id)).length,
  }
}

export function computeDepositsGuarantees(data: ScopedData, filters: ReportFilters = {}, today: ISODate): DepositsGuaranteesReport {
  const f = filterFns(filters)
  const n = names(data)
  const noticeDays = data.company?.settings.guaranteeExpiryNoticeDays ?? []
  const monitored = data.leases.filter((l) => isMonitored(l) && f.inProperty(l.propertyId))
  const rows: DepositsGuaranteesReport['rows'] = []
  let expiring = 0
  let expired = 0
  let totalGuarantees = 0
  for (const l of monitored) {
    if (!l.verified) continue
    if (!l.deposit && !l.bankGuarantee) continue
    const dep = depositCoverage(l, today)
    const gua = guaranteeCoverage(l, today)
    const exp = l.bankGuarantee ? guaranteeExpiryStatus(l.bankGuarantee, today, noticeDays) : undefined
    if (exp && !f.hasStatus(exp.state)) continue
    if (exp?.state === 'expiring') expiring += 1
    if (exp?.state === 'expired') expired += 1
    if (l.bankGuarantee && (exp?.state === 'active' || exp?.state === 'expiring')) totalGuarantees += l.bankGuarantee.amount
    rows.push({
      leaseId: l.id,
      reference: l.reference,
      tenantName: n.tenant(l.tenantId),
      propertyName: n.property(l.propertyId),
      ...(l.deposit ? { depositAmount: l.deposit.amount } : {}),
      ...(dep ? { depositRequired: dep.required } : {}),
      depositShortfall: dep?.shortfall ?? 0,
      ...(l.bankGuarantee ? { guaranteeAmount: l.bankGuarantee.amount, guaranteeExpiresOn: l.bankGuarantee.expiresOn } : {}),
      ...(gua ? { guaranteeRequired: gua.required } : {}),
      guaranteeShortfall: gua?.shortfall ?? 0,
      ...(exp ? { guaranteeState: exp.state, guaranteeDaysUntilExpiry: exp.daysUntilExpiry } : {}),
    })
  }
  return {
    totalDeposits: sumZar(rows.map((r) => r.depositAmount ?? 0)),
    totalGuarantees: roundZar(totalGuarantees),
    depositShortfallTotal: sumZar(rows.map((r) => r.depositShortfall)),
    guaranteeShortfallTotal: sumZar(rows.map((r) => r.guaranteeShortfall)),
    leasesWithShortfall: rows.filter((r) => r.depositShortfall > 0 || r.guaranteeShortfall > 0).length,
    expiringGuarantees: expiring,
    expiredGuarantees: expired,
    rows,
    unverifiedLeasesExcluded: monitored.filter((l) => !l.verified).length,
  }
}

export function computeArrears(data: ScopedData, filters: ReportFilters = {}, today: ISODate): ArrearsReport {
  const f = filterFns(filters)
  const n = names(data)
  const buckets = arrearsBuckets(data)
  const entries = ageArrears(
    data.statements.filter((s) => f.inProperty(s.propertyId) && f.inRange(s.statementDate)),
    today,
    buckets,
  )
  const rows: ArrearsRow[] = entries.map((e) => ({
    tenantId: e.tenantId,
    tenantName: n.tenant(e.tenantId),
    propertyId: e.propertyId,
    propertyName: n.property(e.propertyId),
    statementId: e.statementId,
    statementDate: e.statementDate,
    outstanding: e.outstanding,
    ageDays: e.ageDays,
    bucket: e.bucket,
    underArrangement: data.arrangements.some((a) => a.tenantId === e.tenantId && isArrangementActive(a, today)),
    remindersSuppressed: shouldSuppressArrearsReminder(e.tenantId, data.arrangements, today),
  }))
  return {
    totalOutstanding: totalOutstanding(entries),
    tenantCount: rows.length,
    buckets: ageingBucketLabels(buckets).map((bucket) => {
      const inBucket = rows.filter((r) => r.bucket === bucket)
      return { bucket, amount: sumZar(inBucket.map((r) => r.outstanding)), tenantCount: inBucket.length }
    }),
    rows,
  }
}

export function computePaymentArrangements(data: ScopedData, filters: ReportFilters = {}, today: ISODate): PaymentArrangementsReport {
  const f = filterFns(filters)
  const n = names(data)
  const graceDays = ruleConfig(data, 'arrangement_attention')?.graceDays ?? 0
  const arrangements = data.arrangements.filter(
    (a) => f.inProperty(a.propertyId) && f.inRange(a.agreedOn) && f.hasStatus(a.status),
  )
  const countsByStatus = zeroCounts(ARRANGEMENT_STATUSES)
  const rows: PaymentArrangementsReport['rows'] = arrangements.map((a) => {
    countsByStatus[a.status] += 1
    const progress = arrangementProgress(a)
    const next = nextInstallment(a, today)
    return {
      arrangementId: a.id,
      tenantId: a.tenantId,
      tenantName: n.tenant(a.tenantId),
      propertyName: n.property(a.propertyId),
      status: a.status,
      outstandingBalance: a.outstandingBalance,
      paid: progress.paid,
      remaining: progress.remaining,
      paidCount: progress.paidCount,
      totalCount: progress.totalCount,
      missedCount: a.installments.filter((i) => i.status === 'missed').length,
      overdueCount: isArrangementActive(a, today) ? overdueInstallments(a, today, graceDays).length : 0,
      ...(next ? { nextDueDate: next.dueDate, nextAmount: next.amount } : {}),
    }
  })
  const active = arrangements.filter((a) => isArrangementActive(a, today))
  const activeIds = new Set(active.map((a) => a.id))
  return {
    countsByStatus,
    activeCount: active.length,
    outstandingUnderArrangement: sumZar(rows.filter((r) => activeIds.has(r.arrangementId)).map((r) => r.remaining)),
    paidToDate: sumZar(rows.map((r) => r.paid)),
    missedInstallments: rows.reduce((s, r) => s + r.missedCount, 0),
    overdueInstallments: rows.reduce((s, r) => s + r.overdueCount, 0),
    rows,
  }
}

export function computeStatementProcessing(data: ScopedData, filters: ReportFilters = {}): StatementProcessingReport {
  const f = filterFns(filters)
  const statements = data.statements.filter(
    (s) => f.inProperty(s.propertyId) && f.inRange(s.statementDate) && f.hasStatus(s.status),
  )
  const ids = new Set(statements.map((s) => s.id))
  const extractions = data.extractions.filter((e) => ids.has(e.statementId))
  const countsByStatus = zeroCounts(STATEMENT_STATUSES)
  const bySource = zeroCounts(STATEMENT_SOURCES)
  for (const s of statements) {
    countsByStatus[s.status] += 1
    bySource[s.sourceSystem] += 1
  }
  return {
    total: statements.length,
    countsByStatus,
    bySource,
    averageExtractionConfidence:
      extractions.length === 0
        ? null
        : Math.round((extractions.reduce((s, e) => s + e.overallConfidence, 0) / extractions.length) * 10000) / 10000,
    flaggedFieldCount: extractions.reduce((s, e) => s + e.fields.filter((fl) => fl.flagged).length, 0),
    pendingReview: countsByStatus.review_required,
    duplicates: statements
      .filter((s) => s.status === 'duplicate')
      .map((s) => ({
        statementId: s.id,
        fileName: s.file.fileName,
        ...(s.duplicateOfStatementId ? { duplicateOfStatementId: s.duplicateOfStatementId } : {}),
      })),
  }
}

/** Properties a communication relates to: its own propertyId, lease/statement, the tenant's leases or the owner's properties. */
function communicationPropertyIds(c: Communication, data: ScopedData): Set<EntityId> {
  const out = new Set<EntityId>()
  if (c.propertyId) out.add(c.propertyId)
  if (c.leaseId) {
    const lease = data.leases.find((l) => l.id === c.leaseId)
    if (lease) out.add(lease.propertyId)
  }
  if (c.statementId) {
    const st = data.statements.find((s) => s.id === c.statementId)
    if (st) out.add(st.propertyId)
  }
  if (out.size === 0 && c.tenantId) for (const l of data.leases) if (l.tenantId === c.tenantId) out.add(l.propertyId)
  if (out.size === 0 && c.ownerUserId) for (const p of data.properties) if (p.ownerUserId === c.ownerUserId) out.add(p.id)
  return out
}

export function computeCommunicationActivity(data: ScopedData, filters: ReportFilters = {}): CommunicationActivityReport {
  const f = filterFns(filters)
  const n = names(data)
  const hasPropertyFilter = Boolean(filters.propertyIds && filters.propertyIds.length > 0)
  const comms = data.communications.filter(
    (c) =>
      f.inRange(c.createdAt.slice(0, 10)) &&
      f.hasStatus(c.status) &&
      (!hasPropertyFilter || [...communicationPropertyIds(c, data)].some((id) => f.inProperty(id))),
  )
  const commIds = new Set(comms.map((c) => c.id))
  const byType = zeroCounts(MESSAGE_TYPES)
  const byStatus = zeroCounts(DELIVERY_STATUSES)
  for (const c of comms) {
    byType[c.messageType] += 1
    byStatus[c.status] += 1
  }
  const approvals = data.approvals.filter((a) => commIds.has(a.communicationId))
  const decided = approvals.filter((a) => a.decision !== 'pending' && a.decidedAt)
  const turnaround = decided.map((a) => (Date.parse(a.decidedAt as string) - Date.parse(a.requestedAt)) / 60_000)
  const users = indexById(data.users)
  return {
    total: comms.length,
    outbound: comms.filter((c) => c.direction === 'outbound').length,
    inbound: comms.filter((c) => c.direction === 'inbound').length,
    byType,
    byStatus,
    approvals: {
      pending: approvals.filter((a) => a.decision === 'pending').length,
      approved: approvals.filter((a) => a.decision === 'approved').length,
      rejected: approvals.filter((a) => a.decision === 'rejected').length,
      averageTurnaroundMinutes:
        turnaround.length === 0 ? null : Math.round(turnaround.reduce((s, m) => s + m, 0) / turnaround.length),
    },
    failed: comms
      .filter((c) => c.status === 'failed')
      .map((c) => ({
        communicationId: c.id,
        ...(c.tenantId ? { tenantId: c.tenantId } : {}),
        recipientName: c.tenantId ? n.tenant(c.tenantId) : (users.get(c.ownerUserId ?? '')?.fullName ?? c.counterpartyNumber),
        ...(c.failureReason ? { failureReason: c.failureReason } : {}),
        at: c.sentAt ?? c.createdAt,
      })),
  }
}

/** Compute any report against a snapshot. */
export function computeReport<K extends ReportId>(id: K, data: ScopedData, filters: ReportFilters = {}, today: ISODate): ReportResultMap[K] {
  const builders: { [P in ReportId]: () => ReportResultMap[P] } = {
    portfolio_overview: () => computePortfolioOverview(data, filters, today),
    occupancy: () => computeOccupancy(data, filters),
    lease_monitoring: () => computeLeaseMonitoring(data, filters),
    rental_discrepancies: () => computeRentalDiscrepancies(data, filters),
    lease_expiry: () => computeLeaseExpiry(data, filters, today),
    renewal_deadlines: () => computeRenewalDeadlines(data, filters, today),
    deposits_guarantees: () => computeDepositsGuarantees(data, filters, today),
    arrears: () => computeArrears(data, filters, today),
    payment_arrangements: () => computePaymentArrangements(data, filters, today),
    statement_processing: () => computeStatementProcessing(data, filters),
    communication_activity: () => computeCommunicationActivity(data, filters),
  }
  return builders[id]() as ReportResultMap[K]
}

/** PRD 7.1 dashboard figures, computed from central data via domain rules. */
export function computeDashboardMetrics(data: ScopedData, today: ISODate): DashboardMetrics {
  const settings = data.company?.settings
  const properties = data.properties.filter((p) => p.status !== 'archived')
  const propertyIds = new Set(properties.map((p) => p.id))
  const units = data.units.filter((u) => propertyIds.has(u.propertyId))
  const arrears = ageArrears(data.statements, today, arrearsBuckets(data))
  const expiryWindow = Math.max(0, ...(settings?.leaseExpiryNoticeDays ?? [90]))
  const guaranteeNotice = settings?.guaranteeExpiryNoticeDays ?? []
  return {
    totalProperties: properties.length,
    totalUnits: units.length,
    occupiedUnits: units.filter((u) => u.occupancyStatus === 'occupied').length,
    activeLeases: data.leases.filter(isMonitored).length,
    totalOutstanding: totalOutstanding(arrears),
    escalationDiscrepancies: data.events.filter(
      (e) => e.type === 'rental_escalation_discrepancy' && OPEN_EVENT_STATUSES.includes(e.status),
    ).length,
    upcomingExpiries: upcomingExpiries(data.leases, today, expiryWindow).length,
    upcomingRenewalDeadlines: leasesRequiringRenewalWarning(data.leases, today, settings?.renewalDeadlineWarningDays ?? []).length,
    expiringGuarantees: data.leases.filter(
      (l) => isMonitored(l) && l.bankGuarantee && guaranteeExpiryStatus(l.bankGuarantee, today, guaranteeNotice).state === 'expiring',
    ).length,
    tenantsInArrears: arrears.length,
    activeArrangements: data.arrangements.filter((a) => isArrangementActive(a, today)).length,
    pendingStatementReviews: data.statements.filter((s) => s.status === 'review_required').length,
    pendingApprovals: data.approvals.filter((a) => a.decision === 'pending').length,
  }
}

// ---------------------------------------------------------------------------------- plain API

export function getReport<K extends ReportId>(id: K, filters: ReportFilters = {}, today: ISODate = todayISO()): ReportResultMap[K] {
  return computeReport(id, getScopedData(), filters, today)
}

export const getPortfolioOverview = (filters?: ReportFilters, today?: ISODate) => getReport('portfolio_overview', filters, today)
export const getOccupancyReport = (filters?: ReportFilters, today?: ISODate) => getReport('occupancy', filters, today)
export const getLeaseMonitoringReport = (filters?: ReportFilters, today?: ISODate) => getReport('lease_monitoring', filters, today)
export const getRentalDiscrepancyReport = (filters?: ReportFilters, today?: ISODate) => getReport('rental_discrepancies', filters, today)
export const getLeaseExpiryReport = (filters?: ReportFilters, today?: ISODate) => getReport('lease_expiry', filters, today)
export const getRenewalDeadlinesReport = (filters?: ReportFilters, today?: ISODate) => getReport('renewal_deadlines', filters, today)
export const getDepositsGuaranteesReport = (filters?: ReportFilters, today?: ISODate) => getReport('deposits_guarantees', filters, today)
export const getArrearsReport = (filters?: ReportFilters, today?: ISODate) => getReport('arrears', filters, today)
export const getPaymentArrangementsReport = (filters?: ReportFilters, today?: ISODate) => getReport('payment_arrangements', filters, today)
export const getStatementProcessingReport = (filters?: ReportFilters, today?: ISODate) => getReport('statement_processing', filters, today)
export const getCommunicationActivityReport = (filters?: ReportFilters, today?: ISODate) => getReport('communication_activity', filters, today)

export function getDashboardMetrics(today: ISODate = todayISO()): DashboardMetrics {
  return computeDashboardMetrics(getScopedData(), today)
}

// ---------------------------------------------------------------------------------- hooks

export function useReport<K extends ReportId>(id: K, filters: ReportFilters = {}, today: ISODate = todayISO()): ReportResultMap[K] {
  const data = useScopedData()
  const key = JSON.stringify(filters)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `filters` by value
  return useMemo(() => computeReport(id, data, filters, today), [id, data, key, today])
}

export function useDashboardMetrics(today: ISODate = todayISO()): DashboardMetrics {
  const data = useScopedData()
  return useMemo(() => computeDashboardMetrics(data, today), [data, today])
}
