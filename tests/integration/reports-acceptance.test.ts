import { unwrap } from '@leaseguard/api-client'
import { daysBetween, OPEN_EVENT_STATUSES, renewalNoticeDeadline, type OwnerSummaryDeliveryJob, type ReportEnvelope, type ReportId } from '@leaseguard/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ArrearsReportDataService } from '../../services/reports/src/reports/arrears-report-data.service.ts'
import { MonitoringReportDataService } from '../../services/reports/src/reports/monitoring-report-data.service.ts'
import { OwnerSummaryDataService } from '../../services/reports/src/reports/owner-summary-data.service.ts'
import { OwnerSummaryService } from '../../services/reports/src/reports/owner-summary.service.ts'
import { ReportDataService } from '../../services/reports/src/reports/report-data.service.ts'
import { SecurityReportDataService } from '../../services/reports/src/reports/security-report-data.service.ts'
import { runCompanyOwnerSummaries } from '../../services/reports/src/worker/owner-summary-run.ts'
import { SupabaseOwnerSummaryStore } from '../../services/reports/src/worker/owner-summary-store.ts'
import { addDays, createReportsDataset, removeReportsDataset, REPORTS_EXPECTED as X, saToday, type ReportsDataset } from '../fixtures/reports-acceptance.ts'
import { apiAs, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Reports acceptance (ticket R-08) on the local stack, through the gateway like the web app. A known dataset
 * (`fixtures/reports-acceptance.ts`) is added to each company on a property of its own, and every report is checked:
 *
 * - its figures for that property are the dataset's known figures, and its unfiltered figures equal the dashboard's
 *   (the core API) and the database's for the company;
 * - each filter it offers returns exactly the rows of the unfiltered report that match it, in the same order (the rows
 *   the report frame shows and exports as CSV; the CSV itself is checked in the e2e journey);
 * - it never shows another company's data: no id of the other company's dataset or world appears anywhere in it, and
 *   members of one company get 403 for the other;
 * - the weekly owner summary goes to property owners only and is never handed over for sending without an approved
 *   template (and a connected number).
 */

type User = 'admin' | 'manager' | 'readOnly' | 'owner'
type Company = 'a' | 'b'
type Query = { propertyId?: string[]; status?: string[]; from?: string; to?: string }

const ALL_REPORTS = [
  'portfolio_overview',
  'occupancy',
  'lease_monitoring',
  'rental_discrepancies',
  'lease_expiry',
  'renewal_deadlines',
  'deposits_guarantees',
  'arrears',
  'payment_arrangements',
  'statement_processing',
  'communication_activity',
  'owner_weekly_summary',
] as const satisfies readonly ReportId[]
/** Every report but the owner summary, which company admins only preview. */
const MEMBER_REPORTS = ALL_REPORTS.filter((id) => id !== 'owner_weekly_summary')

const today = saToday()
const datasets = {} as Record<Company, ReportsDataset>

function searchOf(query: Query): string {
  const params = new URLSearchParams()
  for (const id of query.propertyId ?? []) params.append('propertyId', id)
  for (const status of query.status ?? []) params.append('status', status)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** GET /api/v1/reports/{id} through the gateway as `user` in `company`: the status and the parsed body. */
async function fetchReport(id: ReportId, user: User, company: Company, query: Query = {}): Promise<{ status: number; body: unknown }> {
  const { gatewayBaseUrl, accessTokens } = integration()
  const response = await fetch(`${gatewayBaseUrl}/api/v1/reports/${id}${searchOf(query)}`, {
    headers: { authorization: `Bearer ${accessTokens[user]}`, 'x-company-id': world().companies[company].id },
  })
  return { status: response.status, body: await response.json() }
}

async function reportOf<Id extends ReportId>(id: Id, query: Query = {}, company: Company = 'a', user: User = id === 'owner_weekly_summary' ? 'admin' : 'manager'): Promise<ReportEnvelope<Id>> {
  const { status, body } = await fetchReport(id, user, company, query)
  if (status !== 200) throw new Error(`GET ${id} ${JSON.stringify(query)} as ${user} in ${company}: ${status} ${JSON.stringify(body)}`)
  return body as ReportEnvelope<Id>
}

const dashboardOf = (company: Company) => unwrap(apiAs('manager', company).GET('/api/v1/dashboard/summary'))
const ofA = () => datasets.a
const atA = () => ({ propertyId: [ofA().property.id] })

beforeAll(async () => {
  const db = serviceRole()
  const { runId } = integration()
  datasets.a = await createReportsDataset(db, { companyId: world().companies.a.id, managerUserId: world().users.manager.id, ownerUserId: world().users.owner.id, runId: `${runId}a`, today })
  datasets.b = await createReportsDataset(db, { companyId: world().companies.b.id, managerUserId: world().users.manager.id, ownerUserId: null, runId: `${runId}b`, today })
})

afterAll(async () => {
  const db = serviceRole()
  for (const company of ['a', 'b'] as const) {
    if (datasets[company]) await removeReportsDataset(db, datasets[company])
  }
})

// ------------------------------------------------------------------------------------------- known figures

describe('every report shows the known dataset\'s figures for its property', () => {
  it('portfolio overview and occupancy', async () => {
    const portfolio = await reportOf('portfolio_overview', atA())
    expect(portfolio.asOf).toBe(today)
    expect(portfolio.data.properties).toHaveLength(1)
    expect(portfolio.data.properties[0]).toMatchObject({
      propertyId: ofA().property.id,
      unitCount: X.units,
      occupiedUnits: X.occupied,
      vacantUnits: X.vacant,
      activeLeases: X.activeLeases,
      monthlyRentalRoll: X.monthlyRentalRoll,
      outstanding: X.outstanding,
      tenantsInArrears: X.tenantsInArrears,
      openEvents: X.openEvents,
    })
    expect(portfolio.data).toMatchObject({ propertyCount: 1, unitCount: X.units, totalOutstanding: X.outstanding, tenantsInArrears: X.tenantsInArrears, openEvents: X.openEvents })

    const occupancy = await reportOf('occupancy', atA())
    expect(occupancy.data.totals).toMatchObject({ total: X.units, occupied: X.occupied, vacant: X.vacant, floorAreaSqm: X.floorAreaSqm, occupiedAreaSqm: X.occupiedAreaSqm })
    const unit = (id: string) => occupancy.data.units.find((row) => row.unitId === id)
    expect(unit(ofA().units.u1)).toMatchObject({ tenantId: ofA().tenants.t1, tenantSource: 'lease', leaseId: ofA().leases.l1 })
    expect(unit(ofA().units.u2)).toMatchObject({ tenantId: ofA().tenants.t2, tenantSource: 'lease', leaseId: ofA().leases.l2 })
    expect(unit(ofA().units.u3)?.tenantId).toBeUndefined()
  })

  it('lease monitoring and rental discrepancies', async () => {
    const monitoring = await reportOf('lease_monitoring', atA())
    expect(monitoring.data.events.map((row) => row.eventId).sort()).toEqual([ofA().events.e1, ofA().events.e2].sort())
    expect(monitoring.data).toMatchObject({ total: 2, open: 2 })
    expect(monitoring.data.byType).toMatchObject({ rental_escalation_discrepancy: 1, lease_expiry: 1 })
    expect(monitoring.data.byPriority).toMatchObject({ high: 1, medium: 1 })
    const e2 = monitoring.data.events.find((row) => row.eventId === ofA().events.e2)
    expect(e2).toMatchObject({ ageDays: 40, ageBucket: '31-90', leaseId: ofA().leases.l1, tenantId: ofA().tenants.t1, overdue: false })
    // The oldest first.
    expect(monitoring.data.events[0]?.eventId).toBe(ofA().events.e2)

    const discrepancies = await reportOf('rental_discrepancies', atA())
    const row = (lease: string) => discrepancies.data.rows.find((candidate) => candidate.leaseId === lease && candidate.current)
    expect(row(ofA().leases.l1)).toMatchObject({
      source: 'event',
      eventId: ofA().events.e1,
      statementId: ofA().statements.s1,
      periodStart: addDays(today, -20),
      expected: X.l1.expected,
      billed: X.l1.billed,
      difference: X.l1.difference,
      withinTolerance: false,
    })
    expect(row(ofA().leases.l2)).toMatchObject({ expected: X.l2.expected, billed: X.l2.expected, difference: 0, withinTolerance: true })
    expect(discrepancies.data).toMatchObject({
      totalMonthlyDifference: X.l1.difference,
      underBilled: X.l1.difference,
      overBilled: 0,
      outsideToleranceCount: 1,
      openEventCount: 1,
      leasesCompared: 2,
      unverifiedLeasesExcluded: 1,
    })
    expect(discrepancies.data.rows.some((candidate) => candidate.leaseId === ofA().leases.l3)).toBe(false)
  })

  it('lease expiry and renewal deadlines', async () => {
    const expiry = await reportOf('lease_expiry', atA())
    expect(expiry.data.rows.map((row) => row.leaseId)).toEqual([ofA().leases.l1, ofA().leases.l2])
    expect(expiry.data.rows[0]).toMatchObject({ daysUntilExpiry: X.l1.expiryDays, bucket: 'months_0_3', renewalOptionAvailable: true, openEventId: ofA().events.e2 })
    expect(expiry.data.rows[1]).toMatchObject({ daysUntilExpiry: X.l2.expiryDays, bucket: 'later', renewalOptionAvailable: false })
    expect(expiry.data.rows[1]?.openEventId).toBeUndefined()
    expect(expiry.data.buckets.find((bucket) => bucket.bucket === 'months_0_3')).toMatchObject({ count: 1 })
    expect(expiry.data.unverifiedLeasesExcluded).toBe(1)

    const renewals = await reportOf('renewal_deadlines', atA())
    const deadline = renewalNoticeDeadline({ expiryDate: addDays(today, X.l1.expiryDays), renewalOption: { exists: true, noticePeriodMonths: 1 } } as never)
    expect(renewals.data.rows).toHaveLength(1)
    expect(renewals.data.rows[0]).toMatchObject({ leaseId: ofA().leases.l1, noticePeriodMonths: 1, deadline, daysUntilDeadline: daysBetween(today, deadline ?? today) })
  })

  it('deposits and guarantees', async () => {
    const security = await reportOf('deposits_guarantees', atA())
    expect(security.data.rows.map((row) => row.leaseId)).toEqual([ofA().leases.l1])
    expect(security.data.rows[0]).toMatchObject({
      expectedMonthlyRental: X.l1.expected,
      depositAmount: 70_000,
      depositRequired: X.l1.depositRequired,
      depositShortfall: X.l1.depositShortfall,
      guaranteeAmount: 105_000,
      guaranteeRequired: X.l1.guaranteeRequired,
      guaranteeShortfall: X.l1.guaranteeShortfall,
      guaranteeState: 'active',
      needsAttention: true,
    })
    expect(security.data).toMatchObject({
      totalDeposits: 70_000,
      totalGuarantees: 105_000,
      depositShortfallTotal: X.l1.depositShortfall,
      guaranteeShortfallTotal: X.l1.guaranteeShortfall,
      leasesWithShortfall: 1,
      unverifiedLeasesExcluded: 1,
    })
  })

  it('arrears and payment arrangements (records only: nothing takes a payment)', async () => {
    const arrears = await reportOf('arrears', atA())
    expect(arrears.data.rows.map((row) => [row.tenantId, row.statementId, row.outstanding, row.ageDays])).toEqual([
      [ofA().tenants.t1, ofA().statements.s1, X.s1.outstanding, X.s1.ageDays],
      [ofA().tenants.t2, ofA().statements.s2, X.s2.outstanding, X.s2.ageDays],
    ])
    expect(arrears.data.rows[0]).toMatchObject({ underArrangement: false, remindersSuppressed: false })
    expect(arrears.data.rows[1]).toMatchObject({ underArrangement: true, remindersSuppressed: true, arrangementId: ofA().arrangementId })
    expect(arrears.data).toMatchObject({ totalOutstanding: X.outstanding, tenantCount: 2, tenantsUnderArrangement: 1, tenantsWithRemindersSuppressed: 1, outstandingUnderArrangement: X.s2.outstanding })
    expect(arrears.data.buckets.reduce((total, bucket) => total + bucket.amount, 0)).toBe(X.outstanding)

    const arrangements = await reportOf('payment_arrangements', atA())
    expect(arrangements.data.rows).toHaveLength(1)
    expect(arrangements.data.rows[0]).toMatchObject({
      arrangementId: ofA().arrangementId,
      status: 'active',
      suppressArrearsReminders: true,
      outstandingBalance: X.arrangement.outstanding,
      paid: X.arrangement.paid,
      remaining: X.arrangement.remaining,
      paidCount: X.arrangement.paidCount,
      totalCount: X.arrangement.totalCount,
      missedCount: 0,
      overdueCount: 0,
    })
    expect(arrangements.data).toMatchObject({ activeCount: 1, paidToDate: X.arrangement.paid, outstandingUnderArrangement: X.arrangement.remaining })
  })

  it('statement processing and communication activity', async () => {
    const statements = await reportOf('statement_processing', atA())
    expect(statements.data.rows.map((row) => row.statementId).sort()).toEqual(Object.values(ofA().statements).sort())
    expect(statements.data).toMatchObject({ total: 4, verified: 2, pendingReview: 1, rejected: 1, inProgress: 0, processingFailures: 0 })
    expect(statements.data.backlog.map((row) => row.statementId)).toEqual([ofA().statements.s3])

    const messages = await reportOf('communication_activity', atA())
    expect(messages.data.rows.map((row) => row.communicationId).sort()).toEqual(Object.values(ofA().communications).sort())
    expect(messages.data).toMatchObject({ total: 2, outbound: 2, inbound: 0, handedOver: 0, pendingApproval: 1 })
    expect(messages.data.pendingApprovals.map((row) => row.communicationId)).toEqual([ofA().communications.c1])
    expect(messages.data.byStatus).toMatchObject({ pending_approval: 1, draft: 1 })
  })

  it('the weekly owner summary of the property\'s owner', async () => {
    const summary = await reportOf('owner_weekly_summary', atA())
    expect(summary.data.owners.map((owner) => owner.summary.ownerUserId)).toEqual([world().users.owner.id])
    const owner = summary.data.owners[0]!.summary
    expect(owner.properties.map((property) => property.propertyId)).toContain(ofA().property.id)
    // The owner's summary covers every property they own: its figures are the reports' for those properties.
    const propertyId = owner.properties.map((property) => property.propertyId)
    const [arrears, monitoring] = await Promise.all([reportOf('arrears', { propertyId }), reportOf('lease_monitoring', { propertyId })])
    expect(owner.totalOutstanding).toBe(arrears.data.totalOutstanding)
    expect(owner.tenantsInArrears).toBe(arrears.data.tenantCount)
    expect(owner.openEventCount).toBe(monitoring.data.open)
    expect(owner.totalOutstanding).toBeGreaterThanOrEqual(X.outstanding)
  })
})

// ------------------------------------------------------------------------------------------- the dashboard

describe('the unfiltered reports equal the dashboard and the database, in both companies', () => {
  it('for every figure they share', async () => {
    for (const company of ['a', 'b'] as const) {
      const companyId = world().companies[company].id
      const [dashboard, portfolio, occupancy, monitoring, discrepancies, arrears, arrangements, statements, messages] = await Promise.all([
        dashboardOf(company),
        reportOf('portfolio_overview', {}, company),
        reportOf('occupancy', {}, company),
        reportOf('lease_monitoring', {}, company),
        reportOf('rental_discrepancies', {}, company),
        reportOf('arrears', {}, company),
        reportOf('payment_arrangements', {}, company),
        reportOf('statement_processing', {}, company),
        reportOf('communication_activity', {}, company),
      ])
      for (const report of [portfolio, occupancy, monitoring, discrepancies, arrears, arrangements, statements, messages]) expect(report.asOf, company).toBe(dashboard.asOf)

      expect(portfolio.data, company).toMatchObject({
        propertyCount: dashboard.properties,
        unitCount: dashboard.units,
        occupiedUnits: dashboard.occupiedUnits,
        activeLeases: dashboard.activeLeases,
        totalOutstanding: dashboard.totalOutstanding,
        tenantsInArrears: dashboard.tenantsInArrears,
      })
      expect(occupancy.data.totals, company).toMatchObject({ total: dashboard.units, occupied: dashboard.occupiedUnits })
      expect(arrears.data, company).toMatchObject({ totalOutstanding: dashboard.totalOutstanding, tenantCount: dashboard.tenantsInArrears })
      expect(monitoring.data.byType, company).toMatchObject({
        rental_escalation_discrepancy: dashboard.escalationDiscrepancies,
        lease_expiry: dashboard.upcomingExpiries,
        renewal_notice_deadline: dashboard.renewalDeadlines,
        guarantee_expiry: dashboard.expiringGuarantees,
      })
      expect(discrepancies.data.openEventCount, company).toBe(dashboard.escalationDiscrepancies)
      expect(arrangements.data.countsByStatus.active, company).toBe(dashboard.activeArrangements)
      expect(statements.data.pendingReview, company).toBe(dashboard.pendingStatementReviews)
      expect(messages.data.approvals.pending, company).toBe(dashboard.pendingApprovals)

      // And the database's own rows for the company.
      const db = serviceRole()
      const openEvents = check(await db.from('monitoring_events').select('id').eq('company_id', companyId).in('status', [...OPEN_EVENT_STATUSES]), 'open events') as { id: string }[]
      expect(monitoring.data.events.map((row) => row.eventId).sort(), company).toEqual(openEvents.map((row) => row.id).sort())
      const units = check(await db.from('units').select('id, property:properties!units_property_fk!inner(status)').eq('company_id', companyId).neq('property.status', 'archived'), 'units') as { id: string }[]
      expect(occupancy.data.units.map((row) => row.unitId).sort(), company).toEqual(units.map((row) => row.id).sort())
      const uploads = check(await db.from('statements').select('id').eq('company_id', companyId), 'statements') as { id: string }[]
      expect(statements.data.rows.map((row) => row.statementId).sort(), company).toEqual(uploads.map((row) => row.id).sort())
      const sent = check(await db.from('communications').select('id').eq('company_id', companyId), 'communications') as { id: string }[]
      expect(messages.data.rows.map((row) => row.communicationId).sort(), company).toEqual(sent.map((row) => row.id).sort())
    }
  })
})

// ------------------------------------------------------------------------------------------- filters

type Row = Record<string, unknown>

/** How one report's rows are filtered: the rows the frame shows, and each filter's field on a row. */
interface FilterCase {
  id: ReportId
  rows: (data: never) => readonly object[]
  property: (row: object) => string | undefined
  status?: { values: string[]; of: (row: object) => string | undefined }
  dates?: { from: string; to: string; of: (row: object) => string | undefined }
}

const field = (name: string) => (row: object) => (row as Row)[name] as string | undefined
const inRange = (value: string | undefined, from: string, to: string) => value !== undefined && value >= from && value <= to
type Data<Id extends ReportId> = ReportEnvelope<Id>['data']

const FILTER_CASES: FilterCase[] = [
  { id: 'portfolio_overview', rows: (data: Data<'portfolio_overview'>) => data.properties, property: field('propertyId'), status: { values: ['active'], of: field('status') } },
  { id: 'occupancy', rows: (data: Data<'occupancy'>) => data.units, property: field('propertyId'), status: { values: ['vacant'], of: field('occupancyStatus') } },
  {
    id: 'lease_monitoring',
    rows: (data: Data<'lease_monitoring'>) => data.events,
    property: field('propertyId'),
    // Without a status filter the report lists the open events, so an open status narrows the same list.
    status: { values: ['under_review'], of: field('status') },
    dates: { from: addDays(today, -10), to: today, of: field('identifiedOn') },
  },
  {
    id: 'rental_discrepancies',
    rows: (data: Data<'rental_discrepancies'>) => data.rows,
    property: field('propertyId'),
    status: { values: ['outside_tolerance'], of: (row: object) => ((row as Row).withinTolerance ? 'within_tolerance' : 'outside_tolerance') },
    dates: { from: addDays(today, -30), to: today, of: field('periodStart') },
  },
  { id: 'lease_expiry', rows: (data: Data<'lease_expiry'>) => data.rows, property: field('propertyId'), status: { values: ['months_0_3'], of: field('bucket') }, dates: { from: today, to: addDays(today, 90), of: field('expiryDate') } },
  { id: 'renewal_deadlines', rows: (data: Data<'renewal_deadlines'>) => data.rows, property: field('propertyId'), dates: { from: today, to: addDays(today, 60), of: field('deadline') } },
  { id: 'deposits_guarantees', rows: (data: Data<'deposits_guarantees'>) => data.rows, property: field('propertyId'), status: { values: ['active'], of: field('guaranteeState') }, dates: { from: today, to: addDays(today, 1000), of: field('guaranteeExpiresOn') } },
  { id: 'arrears', rows: (data: Data<'arrears'>) => data.rows, property: field('propertyId'), status: { values: ['under_arrangement'], of: (row: object) => ((row as Row).underArrangement ? 'under_arrangement' : 'no_arrangement') } },
  { id: 'payment_arrangements', rows: (data: Data<'payment_arrangements'>) => data.rows, property: field('propertyId'), status: { values: ['active'], of: field('status') }, dates: { from: addDays(today, -30), to: today, of: field('agreedOn') } },
  { id: 'statement_processing', rows: (data: Data<'statement_processing'>) => data.rows, property: field('propertyId'), status: { values: ['verified'], of: field('status') }, dates: { from: today, to: today, of: field('uploadedOn') } },
  { id: 'communication_activity', rows: (data: Data<'communication_activity'>) => data.rows, property: field('propertyId'), status: { values: ['pending_approval'], of: field('status') }, dates: { from: today, to: today, of: field('createdOn') } },
  {
    id: 'owner_weekly_summary',
    rows: (data: Data<'owner_weekly_summary'>) => data.owners,
    // An owner is kept when they own a filtered property.
    property: () => undefined,
  },
]

describe('each filter returns exactly the filtered rows (the rows the frame shows and exports)', () => {
  for (const testCase of FILTER_CASES) {
    it(testCase.id, async () => {
      const id = testCase.id as ReportId
      const all = testCase.rows((await reportOf(id)).data as never)
      const propertyId = ofA().property.id
      const filtered = async (query: Query) => {
        const report = await reportOf(id, query)
        return { filters: report.filters, rows: testCase.rows(report.data as never) }
      }

      const byProperty = await filtered({ propertyId: [propertyId] })
      expect(byProperty.filters).toEqual({ propertyIds: [propertyId] })
      if (id === 'owner_weekly_summary') {
        const owners = all.filter((owner) => (owner as { summary: { properties: { propertyId: string }[] } }).summary.properties.some((property) => property.propertyId === propertyId))
        expect(byProperty.rows).toEqual(owners)
        return
      }
      expect(byProperty.rows.length, 'the dataset has rows in this report').toBeGreaterThan(0)
      expect(byProperty.rows).toEqual(all.filter((row) => testCase.property(row) === propertyId))

      if (testCase.status) {
        const { values, of } = testCase.status
        const byStatus = await filtered({ propertyId: [propertyId], status: values })
        expect(byStatus.filters).toEqual({ propertyIds: [propertyId], statuses: values })
        expect(byStatus.rows.length, `rows with ${values.join(', ')}`).toBeGreaterThan(0)
        expect(byStatus.rows).toEqual(all.filter((row) => testCase.property(row) === propertyId && values.includes(of(row) ?? '')))
      }
      if (testCase.dates) {
        const { from, to, of } = testCase.dates
        const byDates = await filtered({ propertyId: [propertyId], from, to })
        expect(byDates.filters).toEqual({ propertyIds: [propertyId], from, to })
        expect(byDates.rows.length, `rows from ${from} to ${to}`).toBeGreaterThan(0)
        expect(byDates.rows).toEqual(all.filter((row) => testCase.property(row) === propertyId && inRange(of(row), from, to)))
      }
    })
  }
})

// ------------------------------------------------------------------------------------------- isolation

describe('no report shows another company\'s data', () => {
  const idsOf = (company: Company): string[] => {
    const w = world().companies[company]
    return [
      w.id,
      ...datasets[company].ids,
      ...w.properties.map((row) => row.id),
      ...w.units.map((row) => row.id),
      ...w.tenants.map((row) => row.id),
      ...w.leases.map((row) => row.id),
      ...w.monitoringEvents.map((row) => row.id),
    ]
  }

  it('no id of the other company appears anywhere in a report, unfiltered or filtered to the other company\'s property', async () => {
    for (const [mine, theirs] of [
      ['a', 'b'],
      ['b', 'a'],
    ] as const) {
      const foreign = idsOf(theirs)
      for (const id of MEMBER_REPORTS) {
        for (const query of [{}, { propertyId: [datasets[theirs].property.id] }]) {
          const text = JSON.stringify((await reportOf(id, query, mine)).data)
          const leaked = foreign.filter((foreignId) => text.includes(foreignId))
          expect(leaked, `${id} of ${mine} ${JSON.stringify(query)}`).toEqual([])
        }
      }
      // The other company's property filter finds nothing of it.
      const filtered = await reportOf('arrears', { propertyId: [datasets[theirs].property.id] }, mine)
      expect(filtered.data.rows).toEqual([])
    }
    // Company A's admin previews only company A's owners.
    const summary = JSON.stringify((await reportOf('owner_weekly_summary', {}, 'a')).data)
    expect(idsOf('b').filter((id) => summary.includes(id))).toEqual([])
  })

  it('members of one company get 403 for every report of the other', async () => {
    // The admin, the read-only member and the owner belong to company A only.
    for (const id of ALL_REPORTS) {
      for (const user of ['admin', 'readOnly', 'owner'] as const) {
        expect((await fetchReport(id, user, 'b')).status, `${id} as ${user}`).toBe(403)
      }
    }
  })

  it('the same figures for every member role allowed to see a report', async () => {
    for (const id of MEMBER_REPORTS) {
      const manager = (await reportOf(id, atA())).data
      for (const user of ['admin', 'readOnly', 'owner'] as const) {
        expect((await reportOf(id, atA(), 'a', user)).data, `${id} as ${user}`).toEqual(manager)
      }
    }
    for (const user of ['manager', 'readOnly', 'owner'] as const) {
      expect((await fetchReport('owner_weekly_summary', user, 'a')).status, user).toBe(403)
    }
  })
})

// ------------------------------------------------------------------------------------------- the weekly summary

describe('the weekly owner summary goes to owners only, never without an approved template', () => {
  const RUN = integration().runId
  let templateId: string | undefined
  let numberId: string | undefined

  const workerRun = async () => {
    const db = serviceRole() as unknown as SupabaseClient
    const data = new ReportDataService()
    const summaries = new OwnerSummaryService(new OwnerSummaryDataService(data), new ArrearsReportDataService(data), new MonitoringReportDataService(), new SecurityReportDataService(data))
    const requested: OwnerSummaryDeliveryJob[] = []
    const result = await runCompanyOwnerSummaries(
      { compute: (companyId, asOf) => summaries.compute(db, companyId, asOf), store: new SupabaseOwnerSummaryStore(() => db), delivery: { request: async (job) => void requested.push(job) } },
      { companyId: world().companies.a.id, asOf: today },
    )
    return { result, requested }
  }
  const ownerMessages = async () =>
    check(await serviceRole().from('communications').select('id').eq('company_id', world().companies.a.id).eq('message_type', 'owner_weekly_summary'), 'owner messages') as { id: string }[]
  const summary = async () => (await reportOf('owner_weekly_summary')).data

  beforeAll(async () => {
    const db = serviceRole()
    const a = world().companies.a.id
    expectOk(await db.from('message_type_templates').delete().eq('company_id', a).eq('message_type', 'owner_weekly_summary'), 'Clear the mapping')
  })

  afterAll(async () => {
    const db = serviceRole()
    const a = world().companies.a.id
    expectOk(await db.from('message_type_templates').delete().eq('company_id', a).eq('message_type', 'owner_weekly_summary'), 'Delete the mapping')
    if (templateId) expectOk(await db.from('message_templates').delete().eq('id', templateId), 'Delete the template')
    if (numberId) expectOk(await db.from('whatsapp_phone_numbers').delete().eq('id', numberId), 'Delete the number')
  })

  it('previews property owners only, never a tenant', async () => {
    const owners = (await summary()).owners
    const ownerIds = owners.map((owner) => owner.summary.ownerUserId)
    expect(ownerIds).toEqual([world().users.owner.id])
    const tenantIds = [...world().companies.a.tenants.map((tenant) => tenant.id), ...Object.values(ofA().tenants)]
    expect(ownerIds.some((id) => tenantIds.includes(id))).toBe(false)
  })

  it('sends nothing without a template, with a template not yet approved, or without a connected number, and says why', async () => {
    const db = serviceRole()
    const a = world().companies.a.id
    const before = await ownerMessages()

    // 1. No template chosen.
    let preview = await summary()
    expect(preview.blockers.some((blocker) => blocker.includes('No template chosen'))).toBe(true)
    let run = await workerRun()
    expect(run.result.handedOver).toBe(0)
    expect(run.requested).toEqual([])

    // 2. A template chosen but not approved by Meta yet.
    const template = check(
      await db
        .from('message_templates')
        .insert({
          company_id: a,
          name: 'Owner weekly summary (acceptance)',
          message_type: 'owner_weekly_summary',
          audience: 'property_owner',
          meta_template_name: `owner_weekly_acc_${RUN}`,
          language: 'en_ZA',
          category: 'utility',
          body: 'Good morning {{1}}. Your LeaseGuard summary for the week of {{2}}: {{3}}.',
          variables: ['Owner name', 'Week', 'Summary'],
          approval_status: 'submitted',
        })
        .select('id')
        .single(),
      'Insert the submitted template',
    ) as { id: string }
    templateId = template.id
    expectOk(await db.from('message_type_templates').insert({ company_id: a, message_type: 'owner_weekly_summary', message_template_id: template.id }), 'Choose it')
    preview = await summary()
    expect(preview.blockers.length).toBeGreaterThan(0)
    expect(preview.template?.sendable).toBe(false)
    // The page can show the text it would send, and says per owner why it is not sent.
    expect(preview.owners.every((owner) => owner.blockers.length > 0)).toBe(true)
    run = await workerRun()
    expect(run.result.handedOver).toBe(0)
    expect(run.requested).toEqual([])
    // The core's own gate refuses it too.
    const [refused] = check(
      await db.rpc('record_owner_weekly_summary_message', { p_company_id: a, p_owner_user_id: world().users.owner.id, p_week_start: preview.weekStart, p_body: 'Summary' }),
      'Record without an approved template',
    ) as { outcome: string; reason: string }[]
    expect(refused).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('No WhatsApp template approved') })

    // 3. Approved, but the company has no connected number (when it has none).
    expectOk(await db.from('message_templates').update({ approval_status: 'approved' }).eq('id', template.id), 'Approve the template')
    const connected = check(await db.from('whatsapp_phone_numbers').select('id').eq('company_id', a).eq('connection_status', 'connected'), 'numbers') as { id: string }[]
    if (connected.length === 0) {
      preview = await summary()
      expect(preview.blockers.some((blocker) => /number/i.test(blocker))).toBe(true)
      run = await workerRun()
      expect(run.result.handedOver).toBe(0)
      expect(run.requested).toEqual([])
    }

    expect((await ownerMessages()).map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort())
  })

  it('the database records it for a property owner only, never for anyone else or to a tenant', async () => {
    const db = serviceRole()
    const a = world().companies.a.id
    // With the template approved and a number connected, a member who is not an owner is still refused.
    const connected = check(await db.from('whatsapp_phone_numbers').select('id').eq('company_id', a).eq('connection_status', 'connected'), 'numbers') as { id: string }[]
    if (connected.length === 0) {
      numberId = (check(
        await db
          .from('whatsapp_phone_numbers')
          .insert({ company_id: a, business_account_id: `waba-acc-${RUN}`, phone_number_id: `pn-acc-${RUN}`, display_name: 'Acceptance', display_number: '+27 11 555 0198', connection_status: 'connected' })
          .select('id')
          .single(),
        'Connect a number',
      ) as { id: string }).id
    }
    const weekStart = (await summary()).weekStart
    for (const user of [world().users.manager.id, world().users.admin.id, world().users.readOnly.id]) {
      const [result] = check(
        await db.rpc('record_owner_weekly_summary_message', { p_company_id: a, p_owner_user_id: user, p_week_start: weekStart, p_body: 'Summary' }),
        'Record for a non-owner',
      ) as { outcome: string; reason: string }[]
      expect(result).toMatchObject({ outcome: 'blocked', reason: 'User is not a property owner in this company' })
    }
    // An owner summary addressed to a tenant is refused by the database (tenants receive statement and payment
    // messages only), and so is a tenant template for it.
    const tenant = world().companies.a.tenants[0]!
    const toTenant = await db.from('communications').insert({
      company_id: a,
      channel: 'whatsapp',
      direction: 'outbound',
      message_type: 'owner_weekly_summary',
      recipient_type: 'tenant',
      tenant_id: tenant.id,
      counterparty_number: tenant.whatsappNumber,
      company_number: '+27115550100',
      body: 'Weekly summary',
    })
    expect(toTenant.error?.code).toBe('23514')
    const tenantTemplate = await db.from('message_templates').insert({
      company_id: a,
      name: 'Owner summary to tenants',
      message_type: 'owner_weekly_summary',
      audience: 'tenant',
      meta_template_name: `owner_weekly_tenant_${RUN}`,
      language: 'en_ZA',
      category: 'utility',
      body: 'Hello {{1}}',
      variables: ['Name'],
      approval_status: 'approved',
    })
    expect(tenantTemplate.error?.code).toBe('23514')
    // Nothing was recorded by this file.
    const recorded = check(await db.from('communications').select('id').eq('company_id', a).eq('message_type', 'owner_weekly_summary').eq('recipient_type', 'tenant'), 'tenant summaries') as { id: string }[]
    expect(recorded).toEqual([])
  })
})
