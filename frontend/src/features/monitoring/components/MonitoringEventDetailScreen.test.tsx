import { ApiError } from '@leaseguard/api-client'
import type { Lease, MonitoringEventListItem, Statement, UserRole } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { AuditLogEntry } from '@/features/audit/api/source'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { MonitoringEventSource } from '../api/source'
import { MonitoringEventDetailScreen } from './MonitoringEventDetailScreen'

const fakeEvents = vi.hoisted(() => ({
  list: vi.fn<MonitoringEventSource['list']>(),
  get: vi.fn<MonitoringEventSource['get']>(),
  updateStatus: vi.fn<MonitoringEventSource['updateStatus']>(),
}))
const others = vi.hoisted(() => ({ lease: vi.fn(), statement: vi.fn(), arrangement: vi.fn(), audit: vi.fn(), members: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getMonitoringEventSource: () => fakeEvents }))
vi.mock('@/features/leases/api/selectSource', () => ({ getLeaseSource: () => ({ get: others.lease, list: vi.fn() }) }))
vi.mock('@/features/statements/api/selectSource', () => ({ getStatementSource: () => ({ get: others.statement, list: vi.fn() }) }))
vi.mock('@/features/arrangements/api/selectSource', () => ({ getArrangementSource: () => ({ get: others.arrangement, list: vi.fn() }) }))
vi.mock('@/features/audit/api/selectSource', () => ({ getAuditSource: () => ({ list: others.audit }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: others.members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ role: 'property_manager' as UserRole }))
vi.mock('@/features/account/useActiveRole', () => ({
  useActiveRole: () => viewer.role,
  useIsCompanyWriter: () => viewer.role === 'company_admin' || viewer.role === 'property_manager',
}))

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'
const LEASE_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'
const STATEMENT_ID = 'a1b2c3d4-0000-4000-8000-000000000010'
const TODAY = new Date('2026-11-20T10:00:00+02:00')

const { arrangementId: _arrangement, ...base } = sampleRecord('monitoringEvents')
const EVENT: MonitoringEventListItem = {
  ...base,
  id: 'e0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  leaseId: LEASE_ID,
  statementId: STATEMENT_ID,
  status: 'new',
  calculation: {
    expectedAmount: 37_800,
    actualAmount: 35_000,
    difference: 2_800,
    steps: ['Initial rental: R35,000.00', 'Escalation 1 (1 Jun 2026): R35,000.00 × 1.08 = R37,800.00', 'Rental charged on the statement: R35,000.00'],
  },
  propertyName: 'Meadowlands Square',
  unitNumber: 'S02',
  tenantName: 'PharmaCare',
  assigneeName: 'Naledi van der Merwe',
}
const LEASE: Lease = { ...sampleRecord('leases'), id: LEASE_ID, companyId: NEXUS_ID, reference: 'MSQ-L002', verified: true, verifiedByUserId: MANAGER, verifiedAt: '2026-01-10T09:00:00+02:00' }
const STATEMENT: Statement = {
  ...sampleRecord('statements'),
  id: STATEMENT_ID,
  companyId: NEXUS_ID,
  status: 'verified',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  verifiedByUserId: MANAGER,
  verifiedAt: '2026-11-02T08:00:00+02:00',
}
const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [{ companyId: NEXUS_ID, role: 'property_manager' }] } as unknown as CompanyMember
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 50 })

function auditEntry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    companyId: NEXUS_ID,
    actorUserId: MANAGER,
    action: 'update',
    entityType: 'monitoring_event',
    entityId: EVENT.id,
    summary: 'Monitoring event moved',
    occurredAt: '2026-11-03T10:00:00+02:00',
    createdAt: '2026-11-03T10:00:00+02:00',
    updatedAt: '2026-11-03T10:00:00+02:00',
    ...overrides,
  }
}

function renderScreen(event: MonitoringEventListItem = EVENT) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <MonitoringEventDetailScreen event={event} />
      <Toaster />
    </QueryClientProvider>,
    `/monitoring/${event.id}`,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.role = 'property_manager'
  for (const fn of [...Object.values(fakeEvents), ...Object.values(others)]) fn.mockReset()
  others.lease.mockResolvedValue(LEASE)
  others.statement.mockResolvedValue(STATEMENT)
  others.members.mockResolvedValue(page([member]))
  others.audit.mockResolvedValue(page([]))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MonitoringEventDetailScreen', () => {
  it('shows the finding, the recommended action and the calculation with its figures and steps', async () => {
    await renderScreen()

    const finding = screen.getByRole('region', { name: 'Finding' })
    expect(within(finding).getByText(EVENT.description)).toBeInTheDocument()
    expect(within(finding).getByText(EVENT.recommendedAction)).toBeInTheDocument()

    const calculation = screen.getByRole('region', { name: 'Calculation' })
    expect(within(calculation).getByText('Expected rental')).toBeInTheDocument()
    expect(within(calculation).getByText('Billed rental')).toBeInTheDocument()
    expect(within(calculation).getByText('R 37 800,00')).toBeInTheDocument()
    expect(within(calculation).getByText('R 35 000,00')).toBeInTheDocument()
    expect(within(calculation).getByText('R 2 800,00')).toBeInTheDocument()
    const steps = within(within(calculation).getByRole('list', { name: 'Calculation steps' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual(EVENT.calculation!.steps.map((step, index) => `${index + 1}${step}`))
  })

  it('traces the finding to its verified lease and statement, each linked with who verified it', async () => {
    await renderScreen()

    const sources = screen.getByRole('region', { name: 'Sources' })
    const lease = await within(sources).findByRole('link', { name: 'MSQ-L002' })
    expect(lease).toHaveAttribute('href', `/leases/${LEASE_ID}`)
    const statement = await within(sources).findByRole('link', { name: '01 Oct 2026 – 31 Oct 2026' })
    expect(statement).toHaveAttribute('href', `/statements/${STATEMENT_ID}`)
    expect(await within(sources).findAllByText('Naledi van der Merwe')).toHaveLength(2)
    expect(others.lease).toHaveBeenCalledWith(NEXUS_ID, LEASE_ID)
    expect(others.statement).toHaveBeenCalledWith(NEXUS_ID, STATEMENT_ID)
  })

  it('works out a renewal deadline finding from its lease with the domain rule', async () => {
    others.lease.mockResolvedValue({
      ...LEASE,
      expiryDate: '2027-05-31',
      renewalOption: { exists: true, noticePeriodMonths: 6, exercised: false },
    } satisfies Lease)
    const { calculation: _calculation, statementId: _statement, ...rest } = EVENT
    await renderScreen({ ...rest, type: 'renewal_notice_deadline' })

    const calculation = screen.getByRole('region', { name: 'Calculation' })
    expect(await within(calculation).findByText('6 months before expiry')).toBeInTheDocument()
    expect(within(calculation).getByText('Last day for notice')).toBeInTheDocument()
    expect(within(calculation).getByText(/30 Nov 2026/)).toHaveTextContent('10 days left')
  })

  it('offers writers only the moves the domain workflow allows, dismissing first and the forward step last', async () => {
    await renderScreen()
    const buttons = screen.getAllByRole('button').filter((button) => ['Dismiss', 'Start review'].includes(button.textContent ?? ''))
    expect(buttons.map((button) => button.textContent)).toEqual(['Dismiss', 'Start review'])
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })

  it('shows no workflow actions to read-only members or on a closed event', async () => {
    viewer.role = 'read_only'
    const { unmount } = await renderScreen()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    unmount()

    viewer.role = 'property_manager'
    await renderScreen({ ...EVENT, status: 'resolved', resolvedAt: '2026-11-05T09:00:00+02:00', resolvedByUserId: MANAGER })
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('requires a reason to dismiss, then sends it with the move', async () => {
    fakeEvents.updateStatus.mockResolvedValue({ ...EVENT, status: 'dismissed' })
    await renderScreen()

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const dialog = await screen.findByRole('dialog', { name: 'Dismiss this event' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    expect(await within(dialog).findByText('Say why the event is dismissed')).toBeInTheDocument()
    expect(fakeEvents.updateStatus).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Billed correctly under the addendum')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByText('Event moved to dismissed')).toBeInTheDocument()
    expect(fakeEvents.updateStatus).toHaveBeenCalledWith(NEXUS_ID, EVENT.id, { status: 'dismissed', note: 'Billed correctly under the addendum' })
  })

  it('moves forward without a note, and explains a refused move in the dialog', async () => {
    fakeEvents.updateStatus.mockRejectedValue(new ApiError(409, ['The event was changed by someone else; reload it and try again'], null))
    await renderScreen()

    await userEvent.click(screen.getByRole('button', { name: 'Start review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start reviewing this event' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start review' }))
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument()
    expect(fakeEvents.updateStatus).toHaveBeenCalledWith(NEXUS_ID, EVENT.id, { status: 'under_review' })
  })

  it('shows the dismissal reason with who dismissed it, and the history with each note', async () => {
    others.audit.mockResolvedValue(
      page([
        auditEntry({
          id: 'a0000000-0000-4000-8000-000000000002',
          action: 'dismiss',
          summary: 'Dismissed monitoring event "x": Billed correctly under the addendum',
          changes: [
            { field: 'status', before: 'under_review', after: 'dismissed' },
            { field: 'dismissal_reason', before: null, after: 'Billed correctly under the addendum' },
          ],
          occurredAt: '2026-11-04T10:00:00+02:00',
        }),
        auditEntry({
          changes: [
            { field: 'status', before: 'new', after: 'under_review' },
            { field: 'resolution_notes', before: null, after: 'Asked the accountant for the ledger' },
          ],
        }),
      ]),
    )
    await renderScreen({
      ...EVENT,
      status: 'dismissed',
      dismissal: { reason: 'Billed correctly under the addendum', dismissedByUserId: MANAGER, dismissedAt: '2026-11-04T10:00:00+02:00' },
    })

    const outcome = screen.getByRole('region', { name: 'Outcome' })
    expect(within(outcome).getByText('Billed correctly under the addendum')).toBeInTheDocument()
    expect(await within(outcome).findByText('Naledi van der Merwe')).toBeInTheDocument()

    const history = await screen.findByRole('list', { name: `History of ${EVENT.title}` })
    const entries = within(history).getAllByRole('listitem')
    expect(entries.map((entry) => entry.querySelector('p')?.textContent)).toEqual([
      'Under review → Dismissed',
      'New → Under review',
      'Raised as rental escalation discrepancy',
    ])
    expect(within(entries[1]!).getByText('Asked the accountant for the ledger')).toBeInTheDocument()
    expect(others.audit).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ entityType: 'monitoring_event', entityId: EVENT.id }))
  })

  it('does not ask property owners for the audit log', async () => {
    viewer.role = 'property_owner'
    await renderScreen()
    expect(screen.getByText(/property owners do not see/)).toBeInTheDocument()
    expect(others.audit).not.toHaveBeenCalled()
  })
})
