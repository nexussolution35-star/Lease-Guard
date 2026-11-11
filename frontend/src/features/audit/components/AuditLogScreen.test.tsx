import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import type { CompanyMember, UserSource } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace, TEST_USER_ID } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { AuditLogEntry, AuditSource } from '../api/source'
import { auditSearchSchema, type AuditSearch } from '../auditSearch'
import { AuditLogScreen } from './AuditLogScreen'

const fakeAudit = vi.hoisted(() => ({ list: vi.fn<AuditSource['list']>() }))
vi.mock('../api/apiSource', () => ({ createApiAuditSource: () => fakeAudit }))
const fakeUsers = vi.hoisted(() => ({ listMembers: vi.fn<UserSource['listMembers']>() }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => fakeUsers }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ role: 'property_manager' as 'company_admin' | 'property_manager' | 'property_owner' | 'read_only' }))
vi.mock('@/features/account/useActiveRole', () => ({ useActiveRole: () => viewer.role }))

const NALEDI_ID = '5b0c1d2e-0000-4000-8000-0000000000a2'
const GONE_ID = '5b0c1d2e-0000-4000-8000-0000000000ff'

const member = (id: string, fullName: string): CompanyMember =>
  ({
    id,
    fullName,
    email: `${fullName.split(' ')[0]?.toLowerCase()}@example.co.za`,
    status: 'active',
    memberships: [{ companyId: NEXUS_ID, role: 'property_manager', isDefault: true, joinedAt: '2026-10-01T08:00:00+02:00' }],
    createdAt: '2026-10-01T08:00:00+02:00',
    updatedAt: '2026-10-01T08:00:00+02:00',
  }) as CompanyMember

function entry(id: string, overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: `e0000000-0000-4000-8000-00000000000${id}`,
    companyId: NEXUS_ID,
    action: 'update',
    entityType: 'lease',
    entityId: 'a1b2c3d4-0000-4000-8000-0000000000aa',
    summary: 'Lease updated',
    occurredAt: '2026-11-10T09:15:00+02:00',
    createdAt: '2026-11-10T09:15:00+02:00',
    updatedAt: '2026-11-10T09:15:00+02:00',
    ...overrides,
  }
}

const VERIFIED = entry('1', { actorUserId: NALEDI_ID, action: 'verify', summary: 'Lease LSE-0042 verified' })
const UPDATED = entry('2', {
  actorUserId: TEST_USER_ID,
  summary: 'Lease LSE-0042 updated',
  changes: [
    { field: 'monthly_rental', before: 35000, after: 37800 },
    { field: 'guarantee_expiry', before: null, after: '2027-06-30' },
  ],
})
const BY_JOB = entry('3', { action: 'create', entityType: 'monitoring_event', summary: 'Rental escalation discrepancy raised' })
const BY_FORMER = entry('4', { actorUserId: GONE_ID, action: 'upload', entityType: 'statement', summary: 'Statement uploaded' })

const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })

const onFiltersChange = vi.fn()
const onPageChange = vi.fn()

function renderScreen(search: Partial<Record<keyof AuditSearch, unknown>> = {}) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuditLogScreen search={auditSearchSchema.parse(search)} onFiltersChange={onFiltersChange} onPageChange={onPageChange} />
    </QueryClientProvider>,
    '/settings/audit',
  )
}

const row = async (name: RegExp) => within(await screen.findByRole('table', { name: 'Audit log entries, newest first' })).getByRole('row', { name })

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.role = 'property_manager'
  onFiltersChange.mockReset()
  onPageChange.mockReset()
  fakeAudit.list.mockReset()
  fakeUsers.listMembers.mockReset()
  fakeAudit.list.mockResolvedValue(page([VERIFIED, UPDATED, BY_JOB, BY_FORMER]))
  fakeUsers.listMembers.mockResolvedValue(page([member(TEST_USER_ID, 'Sipho Dlamini'), member(NALEDI_ID, 'Naledi van der Merwe')]))
})

describe('AuditLogScreen', () => {
  it('lists who did what and when, in South African format', async () => {
    await renderScreen()
    const verified = await row(/Lease LSE-0042 verified/)
    expect(await within(verified).findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(within(verified).getByText('Verify')).toBeInTheDocument()
    expect(within(verified).getByText(/10 Nov 2026/)).toBeInTheDocument()
    expect(within(verified).getByText('Lease')).toBeInTheDocument()
  })

  it('names background jobs "System" and people who have left "Former member"', async () => {
    await renderScreen()
    expect(within(await row(/Rental escalation discrepancy raised/)).getByText('System')).toBeInTheDocument()
    expect(within(await row(/Statement uploaded/)).getByText('Former member')).toBeInTheDocument()
  })

  it('shows what changed, before and after', async () => {
    await renderScreen()
    const updated = await row(/Lease LSE-0042 updated/)
    await userEvent.click(within(updated).getByText('2 fields changed'))
    const changes = within(updated).getAllByRole('listitem')
    expect(changes[0]).toHaveTextContent('Monthly rental: 35000 → changed to 37800')
    expect(changes[1]).toHaveTextContent('Guarantee expiry: empty → changed to 2027-06-30')
  })

  it('sends the filters in the address to the API', async () => {
    await renderScreen({ action: 'verify', entityType: 'lease', actor: NALEDI_ID, from: '2026-11-01', to: '2026-11-30', page: '2' })
    await screen.findByRole('table')
    expect(fakeAudit.list).toHaveBeenCalledWith(NEXUS_ID, {
      page: 2,
      pageSize: 25,
      action: 'verify',
      entityType: 'lease',
      actorUserId: NALEDI_ID,
      from: '2026-11-01',
      to: '2026-11-30',
    })
  })

  it('changes one filter and keeps the others', async () => {
    await renderScreen({ action: 'verify' })
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('combobox', { name: 'Record type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Statement' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ action: 'verify', entityType: 'statement' })
  })

  it('filters by date and clears every filter', async () => {
    await renderScreen({ action: 'verify' })
    await screen.findByRole('table')
    await userEvent.type(screen.getByLabelText('From'), '2026-11-01')
    expect(onFiltersChange).toHaveBeenLastCalledWith({ action: 'verify', from: '2026-11-01' })
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenLastCalledWith({})
  })

  it('says when no entry matches the filters', async () => {
    fakeAudit.list.mockResolvedValue(page([]))
    await renderScreen({ action: 'archive' })
    expect(await screen.findByText('No entries match these filters')).toBeInTheDocument()
  })

  it('tells property owners the audit log is not for their role, without asking the API', async () => {
    viewer.role = 'property_owner'
    await renderScreen()
    expect(screen.getByText('The audit log is not available for your role')).toBeInTheDocument()
    expect(fakeAudit.list).not.toHaveBeenCalled()
    expect(fakeUsers.listMembers).not.toHaveBeenCalled()
  })

  it('offers a retry when the audit log cannot be loaded', async () => {
    fakeAudit.list.mockRejectedValue(new ApiError(500, [], null))
    await renderScreen()
    expect(await screen.findByText('Could not load the audit log')).toBeInTheDocument()
  })

  it('returns to the last page when the requested page is past the end', async () => {
    fakeAudit.list.mockResolvedValue({ items: [], total: 30, page: 9, pageSize: 25 })
    await renderScreen({ page: '9' })
    await vi.waitFor(() => expect(onPageChange).toHaveBeenCalledWith(2))
  })
})
