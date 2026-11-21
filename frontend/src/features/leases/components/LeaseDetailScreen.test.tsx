import { ApiError } from '@leaseguard/api-client'
import { escalationSchedule, formatZAR, guaranteeCoverage, type Lease, type LeaseDocument, type MonitoringEvent } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { LeaseSource } from '../api/source'
import { LeaseDetailScreen } from './LeaseDetailScreen'

const fakeLeases = vi.hoisted(() => ({
  list: vi.fn<LeaseSource['list']>(),
  get: vi.fn<LeaseSource['get']>(),
  verify: vi.fn<LeaseSource['verify']>(),
  listDocuments: vi.fn<LeaseSource['listDocuments']>(),
}))
const others = vi.hoisted(() => ({ tenant: vi.fn(), property: vi.fn(), unit: vi.fn(), events: vi.fn(), members: vi.fn(), company: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getLeaseSource: () => fakeLeases }))
vi.mock('@/features/tenants/api/selectSource', () => ({ getTenantSource: () => ({ get: others.tenant, list: vi.fn() }) }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ get: others.property, list: vi.fn() }) }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => ({ get: others.unit, list: vi.fn() }) }))
vi.mock('@/features/monitoring/api/selectSource', () => ({ getMonitoringEventSource: () => ({ list: others.events, get: vi.fn() }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: others.members }) }))
vi.mock('@/features/company/api/apiSource', () => ({ createApiCompanySource: () => ({ get: others.company }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'
const TODAY = new Date('2026-11-20T10:00:00+02:00')

const VERIFIED: Lease = {
  ...sampleRecord('leases'),
  id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49',
  companyId: NEXUS_ID,
  tenantId: '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10',
  verifiedByUserId: MANAGER,
  verifiedAt: '2025-01-28T11:20:00+02:00',
}
const { verifiedByUserId: _by, verifiedAt: _at, ...withoutStamp } = VERIFIED
const UNVERIFIED: Lease = { ...withoutStamp, verified: false, status: 'pending_verification' }

const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })
const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [{ companyId: NEXUS_ID, role: 'property_manager' }] } as unknown as CompanyMember
const document: LeaseDocument = {
  id: 'd0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  leaseId: VERIFIED.id,
  documentType: 'bank_guarantee',
  title: 'Standard Bank guarantee',
  file: { fileName: 'guarantee.pdf', storagePath: `${NEXUS_ID}/d0000000-0000-4000-8000-000000000001/guarantee.pdf`, mimeType: 'application/pdf', sizeBytes: 2048, sha256: 'a'.repeat(64) },
  uploadedByUserId: MANAGER,
  uploadedAt: '2026-03-02T09:15:00+02:00',
  createdAt: '2026-03-02T09:15:00+02:00',
  updatedAt: '2026-03-02T09:15:00+02:00',
}
const event: MonitoringEvent = { ...sampleRecord('monitoringEvents'), id: 'e0000000-0000-4000-8000-000000000001', leaseId: VERIFIED.id, title: 'Guarantee below three months of rental', status: 'new' }

function renderScreen(lease: Lease) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <LeaseDetailScreen lease={lease} />
      <Toaster />
    </QueryClientProvider>,
    `/leases/${lease.id}`,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeLeases), ...Object.values(others)]) fn.mockReset()
  others.tenant.mockResolvedValue({ ...sampleRecord('tenants'), id: VERIFIED.tenantId, tradingName: 'Thrifty Foods' })
  others.property.mockResolvedValue({ ...sampleRecord('properties'), id: VERIFIED.propertyId, name: 'Meadowlands Square' })
  others.unit.mockResolvedValue({ ...sampleRecord('units'), id: VERIFIED.unitId, unitNumber: 'A01' })
  others.events.mockImplementation(async (_company: string, params: { pageSize: number }) => (params.pageSize === 1 ? page([], 1) : page([event])))
  others.members.mockResolvedValue(page([member]))
  others.company.mockResolvedValue({ id: NEXUS_ID, settings: { guaranteeExpiryNoticeDays: [60, 30] } })
  fakeLeases.listDocuments.mockResolvedValue([document])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LeaseDetailScreen', () => {
  it('says an unverified lease is not used for financial monitoring and offers writers the one verify action', async () => {
    fakeLeases.verify.mockResolvedValue({ ...VERIFIED })
    await renderScreen(UNVERIFIED)

    expect(screen.getByRole('note')).toHaveTextContent('not used for financial monitoring')
    const verification = screen.getByRole('region', { name: 'Verification' })
    expect(within(verification).getByText('Terms not verified')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Verify terms' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verify terms' }))
    expect(await screen.findByText('Terms of MSQ-L001 verified')).toBeInTheDocument()
    expect(fakeLeases.verify).toHaveBeenCalledWith(NEXUS_ID, UNVERIFIED.id)
  })

  it('keeps the dialog open and explains a refused verification', async () => {
    fakeLeases.verify.mockRejectedValue(new ApiError(403, ['You are not allowed to perform this action'], null))
    await renderScreen(UNVERIFIED)
    await userEvent.click(screen.getByRole('button', { name: 'Verify terms' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verify terms' }))
    expect(await screen.findByText('The terms were not verified')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('offers no verification to members who only read', async () => {
    viewer.writer = false
    await renderScreen(UNVERIFIED)
    expect(screen.queryByRole('button', { name: 'Verify terms' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('a company admin or property manager verifies')
  })

  it('opens the lease form from Edit, the primary action once the terms are verified', async () => {
    await renderScreen(VERIFIED)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: `Edit lease ${VERIFIED.reference}` })).toBeInTheDocument()
  })

  it('shows who verified the terms and when, with no verify action', async () => {
    await renderScreen(VERIFIED)
    const verification = screen.getByRole('region', { name: 'Verification' })
    expect(await within(verification).findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(within(verification).getByText('28 Jan 2025')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify terms' })).not.toBeInTheDocument()
  })

  it('draws the escalation schedule and the rental today from the domain rules', async () => {
    await renderScreen(VERIFIED)
    const schedule = escalationSchedule(VERIFIED, '2026-11-20')
    const table = screen.getByRole('table', { name: 'Escalation schedule of MSQ-L001' })
    expect(within(table).getAllByRole('row')).toHaveLength(schedule.length + 1)
    for (const row of schedule) expect(within(table).getByText(formatZAR(row.monthlyRental))).toBeInTheDocument()
    expect(within(table).getAllByText('In force')).toHaveLength(1)
    const current = schedule.find((row) => row.current)
    expect(current).toBeDefined()
    expect(screen.getAllByText(formatZAR(current!.monthlyRental)).length).toBeGreaterThan(1)
    expect(screen.getByText('7% every year from 01 Mar 2024')).toBeInTheDocument()
  })

  it('shows the renewal notice deadline and the guarantee shortfall against the rental expected today', async () => {
    await renderScreen(VERIFIED)
    const term = screen.getByRole('region', { name: 'Term and renewal' })
    // Expiry 29 Feb 2028 less 9 months' notice.
    expect(within(term).getByText('29 May 2027')).toBeInTheDocument()
    const coverage = guaranteeCoverage(VERIFIED, '2026-11-20')
    expect(coverage?.shortfall).toBeGreaterThan(0)
    const cover = screen.getByRole('region', { name: 'Deposit and guarantee' })
    expect(within(cover).getByText(new RegExp(`Short by ${formatZAR(coverage!.shortfall).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument()
  })

  it('lists the lease documents with their type and uploader, and the related monitoring events', async () => {
    await renderScreen(VERIFIED)
    const documents = screen.getByRole('region', { name: 'Documents' })
    expect(await within(documents).findByText('Standard Bank guarantee')).toBeInTheDocument()
    expect(await within(documents).findByText(/Bank guarantee · Naledi van der Merwe/)).toBeInTheDocument()
    expect(fakeLeases.listDocuments).toHaveBeenCalledWith(NEXUS_ID, VERIFIED.id)

    const events = await screen.findByRole('table', { name: 'Monitoring events of MSQ-L001' })
    expect(within(events).getByRole('link', { name: event.title })).toHaveAttribute('href', `/monitoring/${event.id}`)
    expect(others.events).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ leaseId: VERIFIED.id }))
  })
})
