import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REPORT_CATALOGUE, type ReportEnvelope } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ReportsSource } from '../api/source'
import type { ReportSearch } from '../reportSearch'
import { ReportScreen } from './ReportScreen'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

const MONITORING: ReportEnvelope<'lease_monitoring'> = {
  reportId: 'lease_monitoring',
  asOf: '2026-11-21',
  filters: {},
  data: {
    total: 2,
    open: 2,
    overdue: 1,
    byType: {
      rental_escalation_discrepancy: 1,
      lease_expiry: 1,
      renewal_notice_deadline: 0,
      guarantee_expiry: 0,
      guarantee_shortfall: 0,
      deposit_shortfall: 0,
      arrears: 0,
      arrangement_attention: 0,
      statement_review_required: 0,
    },
    byPriority: { low: 0, medium: 1, high: 1, critical: 0 },
    byStatus: { new: 1, under_review: 1, action_required: 0, in_progress: 0, resolved: 0, dismissed: 0 },
    byProperty: [{ propertyId: PROPERTY_ID, propertyName: 'Maponya Square', total: 2, open: 2, overdue: 1 }],
    byAge: [
      { bucket: '0-7', count: 1 },
      { bucket: '8-30', count: 0 },
      { bucket: '31-90', count: 1 },
      { bucket: '90+', count: 0 },
    ],
    events: [
      {
        eventId: 'e1', type: 'rental_escalation_discrepancy', title: 'Rental under-charged: Dlamini Cellular (S01)', priority: 'high', status: 'under_review',
        propertyId: PROPERTY_ID, propertyName: 'Maponya Square', unitNumber: 'S01', tenantId: 't1', tenantName: 'Dlamini Cellular', leaseId: 'l1',
        leaseReference: 'MSQ-L001', statementId: 's1', identifiedOn: '2026-10-01', dueDate: '2026-11-01', ageDays: 51, ageBucket: '31-90', overdue: true,
      },
      {
        eventId: 'e2', type: 'lease_expiry', title: 'Lease expires in 90 days', priority: 'medium', status: 'new', propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square', identifiedOn: '2026-11-20', ageDays: 1, ageBucket: '0-7', overdue: false,
      },
    ],
  },
}

const DISCREPANCIES: ReportEnvelope<'rental_discrepancies'> = {
  reportId: 'rental_discrepancies',
  asOf: '2026-11-21',
  filters: {},
  data: {
    rows: [
      {
        source: 'event', current: true, eventId: 'e1', eventStatus: 'under_review', leaseId: 'l1', leaseReference: 'MSQ-L001', tenantId: 't1',
        tenantName: 'Dlamini Cellular', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', unitNumber: 'S01', statementId: 's1',
        statementDate: '2026-09-30', periodStart: '2026-09-01', expected: 13996.8, billed: 12960, difference: 1036.8, withinTolerance: false,
        steps: ['Initial rental R 12 000,00', 'Billed rental: R 12 960,00'],
      },
      {
        source: 'recomputed', current: true, leaseId: 'l2', leaseReference: 'MSQ-L002', tenantId: 't2', tenantName: 'Fresh Mart',
        propertyId: PROPERTY_ID, propertyName: 'Maponya Square', statementId: 's2', statementDate: '2026-10-31', periodStart: '2026-10-01',
        expected: 25000, billed: 25000, difference: 0, withinTolerance: true, steps: ['Initial rental R 25 000,00'],
      },
    ],
    totalMonthlyDifference: 1036.8,
    underBilled: 1036.8,
    overBilled: 0,
    outsideToleranceCount: 1,
    eventCount: 1,
    recomputedCount: 0,
    openEventCount: 1,
    leasesCompared: 2,
    awaitingStatement: 1,
    unverifiedLeasesExcluded: 2,
  },
}

const definitionOf = (id: string) => {
  const definition = REPORT_CATALOGUE.find((report) => report.id === id)
  if (!definition) throw new Error(id)
  return definition
}

async function renderReport(id: string, search: ReportSearch = {}, onSearchChange = vi.fn()) {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ReportScreen definition={definitionOf(id)} search={search} onSearchChange={onSearchChange} />
    </QueryClientProvider>,
    `/reports/${id}`,
  )
  return onSearchChange
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.report.mockReset().mockImplementation(async (_companyId: string, id: string) => (id === 'lease_monitoring' ? MONITORING : DISCREPANCIES))
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('Lease monitoring', () => {
  it('shows the open events by type, priority, status, property and age, each event linking to it', async () => {
    await renderReport('lease_monitoring')
    expect(await screen.findByText('Open events')).toBeInTheDocument()
    expect(screen.getByText(/As at/)).toHaveTextContent('As at 21 Nov 2026')
    expect(screen.getByRole('table', { name: 'Events by type' })).toHaveTextContent('Rental escalation discrepancy')
    expect(within(screen.getByRole('table', { name: 'Events by type' })).queryByText('Arrears')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Events by priority' })).toHaveTextContent('Critical')
    expect(screen.getByRole('table', { name: 'Events by status' })).toHaveTextContent('Under review')
    expect(screen.getByRole('table', { name: 'Events by age' })).toHaveTextContent('31–90 days')
    const byProperty = screen.getByRole('table', { name: 'Events by property' })
    expect(within(byProperty).getByRole('link', { name: '2' })).toHaveAttribute('href', `/monitoring?status=open&propertyId=${PROPERTY_ID}`)

    const events = screen.getByRole('table', { name: 'Monitoring events' })
    const row = within(events).getByRole('row', { name: /Rental under-charged/ })
    expect(within(row).getByRole('link', { name: 'Rental under-charged: Dlamini Cellular (S01)' })).toHaveAttribute('href', '/monitoring/e1')
    expect(within(row).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', '/leases/l1')
    expect(row).toHaveTextContent('51 days')
    expect(row).toHaveTextContent('01 Oct 2026')
    expect(row).toHaveTextContent('Overdue')
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'lease_monitoring', {})
  })

  it('offers the event status and identified date filters through the URL', async () => {
    const onSearchChange = await renderReport('lease_monitoring', { status: ['resolved'], from: '2026-10-01' })
    await screen.findByText('Events of the chosen statuses, oldest first. Export CSV saves this table.')
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'lease_monitoring', { statuses: ['resolved'], from: '2026-10-01' })
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Resolved' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({ status: undefined, from: '2026-10-01' })
  })

  it('exports the events table as CSV', async () => {
    await renderReport('lease_monitoring')
    await screen.findByText('Open events')
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    const [fileName, csv] = download.mock.calls[0] as [string, string]
    expect(fileName).toBe('leaseguard-lease-monitoring-2026-11-21.csv')
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Event,Type,Priority,Status,Property,Unit,Tenant,Lease,Identified,Age (days),Due,Overdue')
    expect(lines.slice(1)).toEqual([
      'Rental under-charged: Dlamini Cellular (S01),Rental escalation discrepancy,High,Under review,Maponya Square,S01,Dlamini Cellular,MSQ-L001,2026-10-01,51,2026-11-01,Yes',
      'Lease expires in 90 days,Lease expiry,Medium,New,Maponya Square,,,,2026-11-20,1,,No',
    ])
  })

  it('says when there are no open events', async () => {
    fakeSource.report.mockResolvedValueOnce({ ...MONITORING, data: { ...MONITORING.data, events: [], total: 0, open: 0 } })
    await renderReport('lease_monitoring')
    expect(await screen.findByText('No open monitoring events')).toBeInTheDocument()
  })
})

describe('Rental discrepancies', () => {
  it('shows billed against expected rental per lease, linking to the lease, statement and event, with the calculation', async () => {
    await renderReport('rental_discrepancies')
    expect(await screen.findByText('Monthly difference')).toBeInTheDocument()
    expect(screen.getByText('Of 2 leases compared')).toBeInTheDocument()
    expect(screen.getByText('1 awaiting a verified statement, 2 awaiting verification')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Billed against expected rental per lease' })
    const row = within(table).getByRole('row', { name: /MSQ-L001/ })
    expect(within(row).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', '/leases/l1')
    expect(within(row).getByRole('link', { name: '30 Sep 2026' })).toHaveAttribute('href', '/statements/s1')
    expect(within(row).getByRole('link', { name: /Under review/ })).toHaveAttribute('href', '/monitoring/e1')
    expect(row).toHaveTextContent(/R\s?13\s?996,80/)
    expect(row).toHaveTextContent(/R\s?12\s?960,00/)
    expect(row).toHaveTextContent('Outside tolerance')
    expect(within(row).getByText('Billed rental: R 12 960,00')).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /MSQ-L002/ })).toHaveTextContent('Within tolerance')
  })

  it('filters by comparison outcome through the URL', async () => {
    await renderReport('rental_discrepancies', { status: ['outside_tolerance', 'not_a_status'] })
    await screen.findByText('Monthly difference')
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'rental_discrepancies', { statuses: ['outside_tolerance'] })
    expect(screen.getByRole('button', { name: 'Remove filter: Outside tolerance' })).toBeInTheDocument()
  })

  it('exports the comparison table as CSV with amounts in rand and the calculation', async () => {
    await renderReport('rental_discrepancies')
    await screen.findByText('Monthly difference')
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    const [fileName, csv] = download.mock.calls[0] as [string, string]
    expect(fileName).toBe('leaseguard-rental-discrepancies-2026-11-21.csv')
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(
      'Lease,Tenant,Property,Unit,Statement date,Billing period start,Expected rental (R),Billed rental (R),Difference (R),Comparison,Latest statement,Event status,Calculation',
    )
    expect(lines[1]).toBe(
      'MSQ-L001,Dlamini Cellular,Maponya Square,S01,2026-09-30,2026-09-01,13996.80,12960.00,1036.80,Outside tolerance,Yes,Under review,"Initial rental R 12 000,00 | Billed rental: R 12 960,00"',
    )
  })
})
