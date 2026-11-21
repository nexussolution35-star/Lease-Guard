import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REPORT_CATALOGUE, type OwnerWeeklySummaryPreview, type ReportEnvelope } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ReportsSource } from '../api/source'
import { OwnerWeeklySummaryReportView } from './OwnerWeeklySummaryReportView'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'
const LINE = 'Outstanding R 12 960,00 (up R 2 960,00 since 16 Nov 2026); 1 important monitoring event; 1 rental discrepancy; 1 guarantee expiring; 1 item needs your attention'

const PIETER: OwnerWeeklySummaryPreview = {
  summary: {
    ownerUserId: 'o1',
    ownerName: 'Pieter Botha',
    weekStart: '2026-11-23',
    asOf: '2026-11-23',
    properties: [{ propertyId: PROPERTY_ID, propertyName: 'Maponya Square' }],
    totalOutstanding: 12_960,
    tenantsInArrears: 1,
    outstandingUnderArrangement: 0,
    previous: { weekStart: '2026-11-16', totalOutstanding: 10_000 },
    outstandingChange: 2_960,
    openEventCount: 3,
    importantEvents: [
      { eventId: 'e1', type: 'rental_escalation_discrepancy', title: 'Escalation not applied', priority: 'high', status: 'new', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', identifiedOn: '2026-11-10', overdue: false },
    ],
    discrepancies: [
      { leaseId: 'l1', leaseReference: 'MSQ-L001', tenantName: 'Dlamini Cellular', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', expected: 37_800, billed: 35_000, difference: 2_800 },
    ],
    discrepancyMonthlyDifference: 2_800,
    expiringGuarantees: [
      { leaseId: 'l2', reference: 'MSQ-L002', tenantName: 'Fresh Mart', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', guaranteeBank: 'Absa', guaranteeAmount: 120_000, expiresOn: '2026-12-10', daysUntilExpiry: 17 },
    ],
    attention: [{ kind: 'arrangement_instalments', title: 'Dlamini Cellular: 1 instalment missed on the payment arrangement', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', record: { entity: 'payment_arrangement', id: 'a1' } }],
  },
  values: ['Pieter Botha', '23 Nov 2026', LINE],
  message: `Hi Pieter Botha, week of 23 Nov 2026: ${LINE}`,
  blockers: [],
  delivery: { summaryId: 's1', status: 'handed_over', computedAt: '2026-11-23T05:00:00+00:00', blockers: [], communicationId: 'm1', deliveryStatus: 'delivered', sentAt: '2026-11-23T05:00:05+00:00' },
}

const ZANELE: OwnerWeeklySummaryPreview = {
  summary: { ...PIETER.summary, ownerUserId: 'o2', ownerName: 'Zanele Khumalo', previous: null, outstandingChange: null, totalOutstanding: 500, importantEvents: [], discrepancies: [], expiringGuarantees: [], attention: [] },
  values: ['Zanele Khumalo', '23 Nov 2026', 'Outstanding R 500,00 (first weekly summary)'],
  message: 'Hi Zanele Khumalo, week of 23 Nov 2026: Outstanding R 500,00 (first weekly summary)',
  blockers: ['Owner has no WhatsApp number on record'],
}

const envelope = (patch: Partial<ReportEnvelope<'owner_weekly_summary'>['data']> = {}): ReportEnvelope<'owner_weekly_summary'> => ({
  reportId: 'owner_weekly_summary',
  asOf: '2026-11-23',
  filters: {},
  data: {
    weekStart: '2026-11-23',
    sendWeekday: 'monday',
    nextSendOn: '2026-11-23',
    blockers: [],
    template: { metaTemplateName: 'owner_weekly', language: 'en_ZA', sendable: true, summary: 'Approved by Meta.' },
    owners: [PIETER, ZANELE],
    ...patch,
  },
})

const definition = REPORT_CATALOGUE.find((report) => report.id === 'owner_weekly_summary')!

async function renderReport() {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <OwnerWeeklySummaryReportView definition={definition} search={{}} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
    '/reports/owner_weekly_summary',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.report.mockReset().mockResolvedValue(envelope())
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('Weekly owner summary', () => {
  it('lists every owner with the outstanding, the change since the previous summary and this week’s send', async () => {
    await renderReport()
    const table = await screen.findByRole('table', { name: 'Weekly owner summaries' })
    const [pieter, zanele] = within(table).getAllByRole('row').slice(1)
    expect(pieter).toHaveTextContent('Pieter Botha')
    expect(pieter).toHaveTextContent('R 12 960,00')
    expect(pieter).toHaveTextContent('+R 2 960,00')
    expect(pieter).toHaveTextContent('Delivered')
    expect(zanele).toHaveTextContent('First summary')
    expect(zanele).toHaveTextContent('Not sent yet this week')
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'owner_weekly_summary', {})
  })

  it('previews each owner’s WhatsApp message and every PRD item, linking each record', async () => {
    await renderReport()
    const pieter = await screen.findByRole('article', { name: 'Pieter Botha' })
    expect(within(pieter).getByText(PIETER.message!)).toBeInTheDocument()
    expect(within(pieter).getByRole('link', { name: 'Escalation not applied' })).toHaveAttribute('href', '/monitoring/e1')
    expect(within(pieter).getByRole('link', { name: 'Dlamini Cellular (MSQ-L001)' })).toHaveAttribute('href', '/leases/l1')
    expect(within(pieter).getByRole('link', { name: 'Fresh Mart (MSQ-L002)' })).toHaveAttribute('href', '/leases/l2')
    expect(within(pieter).getByRole('link', { name: /1 instalment missed/ })).toHaveAttribute('href', '/arrangements/a1')
    expect(within(pieter).getByText(/Week of 16 Nov 2026/)).toBeInTheDocument()
    expect(within(pieter).getByRole('link', { name: 'message history' })).toHaveAttribute('href', '/communications')

    const zanele = screen.getByRole('article', { name: 'Zanele Khumalo' })
    expect(within(zanele).getByRole('list', { name: 'Why it is not sent' })).toHaveTextContent('Owner has no WhatsApp number on record')
  })

  it('says why nothing is sent without an approved template or a connected number', async () => {
    fakeSource.report.mockResolvedValue(
      envelope({
        template: undefined,
        blockers: ['Weekly owner summary template: No template chosen. Messages of this type cannot be sent.', 'No WhatsApp number is connected.'],
        owners: [{ ...PIETER, message: undefined, delivery: undefined, blockers: ['No WhatsApp number is connected.'] }],
      }),
    )
    await renderReport()
    const note = await screen.findByRole('region', { name: 'No owner summary is sent while this stands' })
    expect(note).toHaveTextContent('No template chosen')
    expect(note).toHaveTextContent('No WhatsApp number is connected')
    expect(within(note).getByRole('link', { name: 'Settings → Message templates' })).toHaveAttribute('href', '/settings/templates')
    expect(screen.getByText(/The summary line would read/)).toHaveTextContent(LINE)
  })

  it('exports the owners table as CSV', async () => {
    await renderReport()
    await screen.findByRole('table', { name: 'Weekly owner summaries' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(download.mock.calls[0]?.[0]).toBe('leaseguard-owner-weekly-summary-2026-11-23.csv')
    const lines = (download.mock.calls[0] as [string, string])[1].trim().split('\r\n')
    expect(lines[0]).toBe(
      'Owner,Week of,Properties,Outstanding (ZAR),Previous summary week,Change since previous (ZAR),Important events,Rental discrepancies,Guarantees expiring,Items needing attention,This week,Why not sent',
    )
    expect(lines[1]).toBe('Pieter Botha,2026-11-23,Maponya Square,12960.00,2026-11-16,2960.00,1,1,1,1,Delivered,')
    expect(lines[2]).toBe('Zanele Khumalo,2026-11-23,Maponya Square,500.00,,,0,0,0,0,Not sent yet this week,Owner has no WhatsApp number on record')
  })
})
