import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REPORT_CATALOGUE, type CommunicationActivityRow, type ReportEnvelope, type StatementUploadRow } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ReportsSource } from '../api/source'
import type { ReportSearch } from '../reportSearch'
import { CommunicationActivityReportView } from './CommunicationActivityReportView'
import { StatementProcessingReportView } from './StatementProcessingReportView'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

const REVIEW: StatementUploadRow = {
  statementId: 's1',
  fileName: 'MSQ-2026-10.pdf',
  propertyId: PROPERTY_ID,
  propertyName: 'Maponya Square',
  tenantId: 't1',
  tenantName: 'Dlamini Cellular',
  unitId: 'u1',
  unitNumber: 'S01',
  sourceSystem: 'MRI',
  status: 'review_required',
  uploadedAt: '2026-11-11T09:00:00+00:00',
  uploadedOn: '2026-11-11',
  processingFailed: false,
  extractionConfidence: 0.62,
  unresolvedFields: 2,
  ageDays: 10,
}
const FAILED: StatementUploadRow = {
  statementId: 's2',
  fileName: 'unreadable.pdf',
  propertyId: PROPERTY_ID,
  propertyName: 'Maponya Square',
  sourceSystem: 'PropSys',
  status: 'review_required',
  uploadedAt: '2026-11-08T09:00:00+00:00',
  uploadedOn: '2026-11-08',
  processingFailed: true,
  processingError: 'The PDF could not be read',
  unresolvedFields: 0,
  ageDays: 13,
}
const VERIFIED: StatementUploadRow = { ...REVIEW, statementId: 's3', fileName: 'MSQ-2026-09.pdf', status: 'verified', unresolvedFields: 0, ageDays: 40, extractionConfidence: 0.98, uploadedAt: '2026-10-12T09:00:00+00:00', uploadedOn: '2026-10-12' }

const FIGURES = { total: 3, inProgress: 0, pendingReview: 2, processingFailures: 1, verified: 1, rejected: 0, duplicate: 0 }

const STATEMENTS: ReportEnvelope<'statement_processing'> = {
  reportId: 'statement_processing',
  asOf: '2026-11-21',
  filters: {},
  data: {
    ...FIGURES,
    countsByStatus: { uploaded: 0, processing: 0, review_required: 2, verified: 1, rejected: 0, duplicate: 0 },
    bySource: [
      { sourceSystem: 'MRI', total: 2, inProgress: 0, pendingReview: 1, processingFailures: 0, verified: 1, rejected: 0, duplicate: 0 },
      { sourceSystem: 'PropSys', total: 1, inProgress: 0, pendingReview: 1, processingFailures: 1, verified: 0, rejected: 0, duplicate: 0 },
    ],
    byProperty: [{ propertyId: PROPERTY_ID, propertyName: 'Maponya Square', ...FIGURES }],
    awaitingReview: 1,
    oldestPendingReviewDays: 13,
    averageExtractionConfidence: 0.8,
    backlog: [FAILED, REVIEW],
    failures: [FAILED],
    rows: [REVIEW, FAILED, VERIFIED],
  },
}

const PENDING: CommunicationActivityRow = {
  communicationId: 'm1',
  createdAt: '2026-11-19T08:00:00+00:00',
  createdOn: '2026-11-19',
  channel: 'whatsapp',
  direction: 'outbound',
  messageType: 'overdue_payment_reminder',
  recipientType: 'tenant',
  counterpartyName: 'Dlamini Cellular',
  tenantId: 't1',
  propertyId: PROPERTY_ID,
  propertyName: 'Maponya Square',
  status: 'pending_approval',
  approvalDecision: 'pending',
  approvalRequestedAt: '2026-11-19T08:00:00+00:00',
}
const FAILED_MESSAGE: CommunicationActivityRow = {
  communicationId: 'm2',
  createdAt: '2026-11-20T08:00:00+00:00',
  createdOn: '2026-11-20',
  channel: 'whatsapp',
  direction: 'outbound',
  messageType: 'owner_weekly_summary',
  recipientType: 'property_owner',
  counterpartyName: 'Pieter Botha',
  status: 'failed',
  outcome: 'failed',
  failureReason: 'Number not on WhatsApp',
}
const DELIVERED: CommunicationActivityRow = {
  ...PENDING,
  communicationId: 'm3',
  messageType: 'monthly_statement',
  statementId: 's3',
  status: 'delivered',
  outcome: 'delivered',
  approvalDecision: 'approved',
  approvalDecidedAt: '2026-11-19T08:45:00+00:00',
}

const GROUP = { total: 3, outbound: 3, inbound: 0, handedOver: 2, delivered: 1, failed: 1, pendingApproval: 1 }

const COMMUNICATIONS: ReportEnvelope<'communication_activity'> = {
  reportId: 'communication_activity',
  asOf: '2026-11-21',
  filters: {},
  data: {
    ...GROUP,
    byType: [
      { messageType: 'monthly_statement', total: 1, outbound: 1, inbound: 0, handedOver: 1, delivered: 1, failed: 0, pendingApproval: 0 },
      { messageType: 'overdue_payment_reminder', total: 1, outbound: 1, inbound: 0, handedOver: 0, delivered: 0, failed: 0, pendingApproval: 1 },
      { messageType: 'owner_weekly_summary', total: 1, outbound: 1, inbound: 0, handedOver: 1, delivered: 0, failed: 1, pendingApproval: 0 },
    ],
    byStatus: { draft: 0, pending_approval: 1, approved: 0, queued: 0, sent: 0, delivered: 1, read: 0, failed: 1, rejected: 0, received: 0 },
    byProperty: [
      { propertyId: PROPERTY_ID, propertyName: 'Maponya Square', total: 2, outbound: 2, inbound: 0, handedOver: 1, delivered: 1, failed: 0, pendingApproval: 1 },
      { propertyId: null, propertyName: null, total: 1, outbound: 1, inbound: 0, handedOver: 1, delivered: 0, failed: 1, pendingApproval: 0 },
    ],
    outcomes: { pending: 0, delivered: 1, read: 0, failed: 1 },
    deliveryRate: 0.5,
    approvals: {
      pending: 1,
      approved: 1,
      rejected: 0,
      averageTurnaroundMinutes: 45,
      oldestPendingHours: 50,
      byAge: [
        { bucket: 'under_1_day', count: 0 },
        { bucket: '1_3_days', count: 1 },
        { bucket: '3_7_days', count: 0 },
        { bucket: 'over_7_days', count: 0 },
      ],
    },
    pendingApprovals: [{ ...PENDING, approvalRequestedAt: '2026-11-19T08:00:00+00:00', waitingHours: 50, ageBucket: '1_3_days' }],
    failedMessages: [FAILED_MESSAGE],
    rows: [FAILED_MESSAGE, DELIVERED, PENDING],
  },
}

const definitionOf = (id: string) => {
  const definition = REPORT_CATALOGUE.find((report) => report.id === id)
  if (!definition) throw new Error(id)
  return definition
}

const VIEWS = { statement_processing: StatementProcessingReportView, communication_activity: CommunicationActivityReportView }

async function renderReport(id: keyof typeof VIEWS, search: ReportSearch = {}, onSearchChange = vi.fn()) {
  const View = VIEWS[id]
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <View definition={definitionOf(id)} search={search} onSearchChange={onSearchChange} />
    </QueryClientProvider>,
    `/reports/${id}`,
  )
  return onSearchChange
}

const csvLines = () => (download.mock.calls[0] as [string, string])[1].trim().split('\r\n')

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.report.mockReset().mockImplementation(async (_companyId: string, id: string) => (id === 'statement_processing' ? STATEMENTS : COMMUNICATIONS))
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('Statement processing', () => {
  it('shows the review backlog oldest first, linking each statement, with its age and the fields still to resolve', async () => {
    await renderReport('statement_processing')
    const backlog = await screen.findByRole('table', { name: 'Statements waiting for review' })
    expect(screen.getByText(/As at/)).toHaveTextContent('As at 21 Nov 2026')
    const rows = within(backlog).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('unreadable.pdf')
    expect(rows[0]).toHaveTextContent('13 days')
    expect(rows[0]).toHaveTextContent('Processing failed')
    expect(rows[1]).toHaveTextContent('10 days')
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'MSQ-2026-10.pdf' })).toHaveAttribute('href', '/statements/s1')
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Dlamini Cellular' })).toHaveAttribute('href', '/tenants/t1')
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'statement_processing', {})
  })

  it('lists the processing failures with why, and the uploads by source and property', async () => {
    await renderReport('statement_processing')
    const failures = await screen.findByRole('table', { name: 'Statements whose processing failed' })
    expect(failures).toHaveTextContent('The PDF could not be read')
    const sources = screen.getByRole('table', { name: 'Uploads by source system' })
    expect(within(sources).getByRole('row', { name: /^PropSys/ })).toBeInTheDocument()
    const properties = screen.getByRole('table', { name: 'Uploads by property' })
    expect(within(properties).getByRole('link', { name: 'Maponya Square' })).toHaveAttribute('href', `/properties/${PROPERTY_ID}`)
  })

  it('exports the uploads shown as CSV', async () => {
    await renderReport('statement_processing')
    await screen.findByRole('table', { name: 'Every statement upload' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(download.mock.calls[0]?.[0]).toBe('leaseguard-statement-processing-2026-11-21.csv')
    expect(csvLines()).toEqual([
      'File name,Statement number,Property,Tenant,Unit,Source system,Uploaded on,Statement date,Status,Days since upload,Fields to resolve,Extraction confidence (%),Processing error',
      'MSQ-2026-10.pdf,,Maponya Square,Dlamini Cellular,S01,MRI,2026-11-11,,Review required,10,2,62.0,',
      'unreadable.pdf,,Maponya Square,,,PropSys,2026-11-08,,Processing failed,13,0,,The PDF could not be read',
      'MSQ-2026-09.pdf,,Maponya Square,Dlamini Cellular,S01,MRI,2026-10-12,,Verified,40,,98.0,',
    ])
  })

  it('filters by statement status and upload date through the URL', async () => {
    const onSearchChange = await renderReport('statement_processing', { status: ['review_required'], from: '2026-11-01' })
    await screen.findByRole('table', { name: 'Every statement upload' })
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'statement_processing', { from: '2026-11-01', statuses: ['review_required'] })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: /^Statement status, 1 selected/ })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /^Uploaded:/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Review required' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({ status: undefined, from: '2026-11-01' })
  })

  it('says when nothing has been uploaded', async () => {
    fakeSource.report.mockResolvedValueOnce({ ...STATEMENTS, data: { ...STATEMENTS.data, rows: [], backlog: [], failures: [] } })
    await renderReport('statement_processing')
    expect(await screen.findByText('No statements uploaded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })
})

describe('Communication activity', () => {
  it('shows the messages awaiting approval with how long they have waited, linking to the approvals queue', async () => {
    await renderReport('communication_activity')
    const pending = await screen.findByRole('table', { name: 'Messages awaiting approval' })
    const row = within(pending).getAllByRole('row')[1] as HTMLElement
    expect(row).toHaveTextContent('2 days')
    expect(within(row).getByRole('link', { name: 'Overdue payment reminder' })).toHaveAttribute('href', '/communications/approvals')
    expect(within(row).getByRole('link', { name: 'Dlamini Cellular' })).toHaveAttribute('href', '/tenants/t1')
    const ages = screen.getByRole('table', { name: 'Messages awaiting approval by how long they have waited' })
    expect(within(ages).getByRole('row', { name: /^1–3 days/ })).toHaveTextContent('1')
    expect(screen.getByText('Longest waiting 2 days')).toBeInTheDocument()
  })

  it('shows the failed messages, the delivery outcomes, and the messages by type and property', async () => {
    await renderReport('communication_activity')
    const failed = await screen.findByRole('table', { name: 'Messages that failed' })
    expect(failed).toHaveTextContent('Pieter Botha')
    expect(failed).toHaveTextContent('Number not on WhatsApp')
    const outcomes = screen.getByRole('table', { name: 'Delivery outcomes' })
    expect(within(outcomes).getByRole('row', { name: /^Failed/ })).toHaveTextContent('50%')
    const byType = screen.getByRole('table', { name: 'Messages by type' })
    expect(within(byType).getByRole('row', { name: /^Owner weekly summary/ })).toBeInTheDocument()
    const byProperty = screen.getByRole('table', { name: 'Messages by property' })
    expect(byProperty).toHaveTextContent('No property (owner summaries, contacts)')
    const messages = screen.getByRole('table', { name: 'Every message' })
    expect(within(messages).getByRole('link', { name: 'Statement' })).toHaveAttribute('href', '/statements/s3')
  })

  it('offers no send or approve action: approving happens on the approvals screen', async () => {
    await renderReport('communication_activity')
    await screen.findByRole('table', { name: 'Every message' })
    const buttons = screen.getAllByRole('button').map((button) => button.textContent?.trim() ?? '')
    expect(buttons.filter((text) => /send|approve|reject|retry/i.test(text))).toEqual([])
  })

  it('exports the messages shown as CSV', async () => {
    await renderReport('communication_activity')
    await screen.findByRole('table', { name: 'Every message' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(download.mock.calls[0]?.[0]).toBe('leaseguard-communication-activity-2026-11-21.csv')
    expect(csvLines()).toEqual([
      'Recorded on,Channel,Direction,Message type,Counterparty type,Counterparty,Property,Status,Delivery outcome,Approval,Approval requested on,Failure reason',
      '2026-11-20,WhatsApp,Outbound,Owner weekly summary,Property owner,Pieter Botha,,Failed,Failed,,,Number not on WhatsApp',
      '2026-11-19,WhatsApp,Outbound,Monthly statement,Tenant,Dlamini Cellular,Maponya Square,Delivered,"Delivered, not read",Approved,2026-11-19,',
      '2026-11-19,WhatsApp,Outbound,Overdue payment reminder,Tenant,Dlamini Cellular,Maponya Square,Pending approval,,Pending,2026-11-19,',
    ])
  })

  it('filters by message status and date through the URL', async () => {
    await renderReport('communication_activity', { status: ['failed'], to: '2026-11-20' })
    await screen.findByRole('table', { name: 'Every message' })
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'communication_activity', { to: '2026-11-20', statuses: ['failed'] })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: /^Message status, 1 selected/ })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /^Message date:/ })).toBeInTheDocument()
  })
})
