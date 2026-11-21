import { ApiError } from '@leaseguard/api-client'
import { addDaysISO, isoToday, type Communication, type LeaseListItem, type PaymentArrangement, type Statement, type Tenant } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { TenantSource } from '../api/source'
import { TenantDetailScreen } from './TenantDetailScreen'

const fakeTenants = vi.hoisted(() => ({
  list: vi.fn<TenantSource['list']>(),
  get: vi.fn<TenantSource['get']>(),
  create: vi.fn<TenantSource['create']>(),
  update: vi.fn<TenantSource['update']>(),
  validateWhatsApp: vi.fn<TenantSource['validateWhatsApp']>(),
}))
const lists = vi.hoisted(() => ({ leases: vi.fn(), statements: vi.fn(), communications: vi.fn(), arrangements: vi.fn(), members: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getTenantSource: () => fakeTenants }))
vi.mock('@/features/leases/api/selectSource', () => ({ getLeaseSource: () => ({ list: lists.leases, get: vi.fn() }) }))
vi.mock('@/features/statements/api/selectSource', () => ({ getStatementSource: () => ({ list: lists.statements, get: vi.fn() }) }))
vi.mock('@/features/communications/api/selectSource', () => ({ getCommunicationSource: () => ({ list: lists.communications, get: vi.fn() }) }))
vi.mock('@/features/arrangements/api/selectSource', () => ({ getArrangementSource: () => ({ list: lists.arrangements, get: vi.fn() }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: lists.members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'
const TODAY = isoToday(new Date())

const TENANT: Tenant = {
  ...sampleRecord('tenants'),
  id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49',
  companyId: NEXUS_ID,
  legalName: 'Soweto Shoes (Pty) Ltd',
  tradingName: 'Soweto Shoes',
  businessType: 'pty_ltd',
  primaryContact: { fullName: 'Sizwe Mabena', role: 'Owner', phone: '+27825550199' },
  whatsappNumber: '+27825550199',
  whatsappVerified: true,
  whatsappValidatedAt: '2026-11-02T09:30:00+02:00',
  whatsappValidatedByUserId: MANAGER,
  whatsappOptedOut: false,
  status: 'in_arrears',
  industry: 'Retail',
}

const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })
const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [{ companyId: NEXUS_ID, role: 'property_manager' }] } as unknown as CompanyMember
const verified: Statement = {
  ...sampleRecord('statements'),
  id: 'a0000000-0000-4000-8000-000000000001',
  tenantId: TENANT.id,
  status: 'verified',
  statementDate: addDaysISO(TODAY, -45),
  closingBalance: 18250.5,
  verifiedByUserId: MANAGER,
  verifiedAt: '2026-10-05T10:00:00+02:00',
}
const inReview: Statement = { ...verified, id: 'a0000000-0000-4000-8000-000000000002', status: 'review_required', statementDate: addDaysISO(TODAY, -10), closingBalance: 99999 }
const message: Communication = { ...sampleRecord('communications'), id: 'c0000000-0000-4000-8000-000000000001', tenantId: TENANT.id, messageType: 'overdue_payment_reminder', status: 'delivered' }
const lease: LeaseListItem = {
  ...sampleRecord('leases'),
  id: 'l0000000-0000-4000-8000-000000000001',
  reference: 'MSQ-L001',
  tenantId: TENANT.id,
  unitId: 'u0000000-0000-4000-8000-000000000001',
  propertyId: 'p0000000-0000-4000-8000-000000000001',
  commencementDate: '2024-03-01',
  expiryDate: '2029-02-28',
  status: 'active',
  verified: true,
  verifiedByUserId: MANAGER,
  verifiedAt: '2024-02-20T09:00:00Z',
  tenantName: 'Soweto Shoes',
  propertyName: 'Maponya Square',
  unitNumber: 'S01',
}

function renderScreen(tenant: Tenant = TENANT) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <TenantDetailScreen tenant={tenant} />
      <Toaster />
    </QueryClientProvider>,
    `/tenants/${tenant.id}`,
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeTenants), ...Object.values(lists)]) fn.mockReset()
  lists.leases.mockResolvedValue(page([lease]))
  lists.statements.mockImplementation(async (_company: string, params: { status?: string }) =>
    params.status === 'verified' ? page([verified], 3) : page([inReview, verified], 2),
  )
  lists.communications.mockResolvedValue(page([message], 1))
  lists.arrangements.mockResolvedValue(page<PaymentArrangement>([]))
  lists.members.mockResolvedValue(page([member]))
})

describe('TenantDetailScreen', () => {
  it('reads statements, arrears, communications and leases through their feature hooks, for this tenant', async () => {
    await renderScreen()
    expect(screen.getByRole('heading', { level: 1, name: 'Soweto Shoes' })).toBeInTheDocument()
    await screen.findByRole('table', { name: 'Statements of Soweto Shoes' })
    await screen.findByRole('table', { name: 'Messages with Soweto Shoes' })
    expect(lists.statements).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ tenantId: TENANT.id, status: 'verified', sort: 'statementDate', direction: 'desc' }))
    expect(lists.statements).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ tenantId: TENANT.id, sort: 'statementDate' }))
    expect(lists.communications).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ tenantId: TENANT.id }))
    expect(lists.leases).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ tenantId: TENANT.id }))
    expect(lists.arrangements).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ tenantId: TENANT.id, status: 'active' }))
  })

  it('ages the arrears from the latest verified statement only', async () => {
    await renderScreen()
    const arrears = await screen.findByRole('region', { name: 'Arrears' })
    expect(await within(arrears).findByText('R 18 250,50')).toBeInTheDocument()
    expect(within(arrears).getByText('45 days (30–59 days)')).toBeInTheDocument()
    expect(within(arrears).getByRole('link')).toHaveAttribute('href', `/statements/${verified.id}`)
    // The statement still in review is listed in the history but never counts, and its balance is not shown.
    const history = await screen.findByRole('table', { name: 'Statements of Soweto Shoes' })
    expect(within(history).getByText('Not verified')).toBeInTheDocument()
    expect(screen.queryByText('R 99 999,00')).not.toBeInTheDocument()
  })

  it('says when there is no verified statement to age', async () => {
    lists.statements.mockImplementation(async (_company: string, params: { status?: string }) => (params.status === 'verified' ? page([]) : page([inReview])))
    await renderScreen()
    const arrears = await screen.findByRole('region', { name: 'Arrears' })
    expect(await within(arrears).findByText('No verified statements yet')).toBeInTheDocument()
  })

  it('shows that arrears reminders are paused by an active payment arrangement', async () => {
    const arrangement = { ...sampleRecord('paymentArrangements'), tenantId: TENANT.id, status: 'active', agreedOn: addDaysISO(TODAY, -5), suppressArrearsReminders: true } as PaymentArrangement
    delete (arrangement as { closedOn?: string }).closedOn
    lists.arrangements.mockResolvedValue(page([arrangement]))
    await renderScreen()
    expect(await screen.findByText('Payment arrangement active: arrears reminders are paused')).toBeInTheDocument()
  })

  it('shows who validated the number and that reminders are on', async () => {
    await renderScreen()
    const whatsapp = screen.getByRole('region', { name: 'WhatsApp and reminders' })
    expect(within(whatsapp).getByText('+27 82 555 0199')).toBeInTheDocument()
    expect(within(whatsapp).getByText('Validated')).toBeInTheDocument()
    expect(await within(whatsapp).findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(within(whatsapp).getByText(/Automated reminders are on/)).toBeInTheDocument()
    expect(within(whatsapp).queryByRole('button', { name: 'Validate number' })).not.toBeInTheDocument()
  })

  it('explains why reminders are off for an unvalidated number, and lets a writer validate it', async () => {
    const unvalidated: Tenant = { ...TENANT, whatsappVerified: false }
    delete unvalidated.whatsappValidatedAt
    delete unvalidated.whatsappValidatedByUserId
    fakeTenants.validateWhatsApp.mockResolvedValue(TENANT)
    await renderScreen(unvalidated)
    const whatsapp = screen.getByRole('region', { name: 'WhatsApp and reminders' })
    expect(within(whatsapp).getByText('Automated reminders are off')).toBeInTheDocument()
    expect(within(whatsapp).getByText(/The WhatsApp number has not been validated/)).toBeInTheDocument()
    expect(within(whatsapp).getByText('Awaiting validation')).toBeInTheDocument()

    await userEvent.click(within(whatsapp).getByRole('button', { name: 'Validate number' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Validate number' }))
    expect(await screen.findByText('+27 82 555 0199 validated')).toBeInTheDocument()
    expect(fakeTenants.validateWhatsApp).toHaveBeenCalledWith(NEXUS_ID, TENANT.id, '+27825550199')
  })

  it('explains a validation refused because the number changed meanwhile', async () => {
    fakeTenants.validateWhatsApp.mockRejectedValue(
      new ApiError(409, ["The tenant's WhatsApp number has changed since it was checked. Check the number now on record and validate that one."], null),
    )
    await renderScreen({ ...TENANT, whatsappVerified: false })
    await userEvent.click(screen.getByRole('button', { name: 'Validate number' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Validate number' }))
    expect(await screen.findByText('The number was not validated')).toBeInTheDocument()
    expect(screen.getByText(/has changed since it was checked/)).toBeInTheDocument()
  })

  it('names an opt-out and a prospective tenant as reasons too', async () => {
    await renderScreen({ ...TENANT, whatsappOptedOut: true, status: 'prospective' })
    expect(screen.getByText('The tenant opted out of WhatsApp messages.')).toBeInTheDocument()
    expect(screen.getByText(/The tenant is prospective/)).toBeInTheDocument()
  })

  it('lists the unit and lease with who verified the terms', async () => {
    await renderScreen()
    const leases = await screen.findByRole('table', { name: 'Leases of Soweto Shoes' })
    expect(within(leases).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', `/leases/${lease.id}`)
    expect(within(leases).getByRole('link', { name: 'S01' })).toHaveAttribute('href', `/units/${lease.unitId}`)
    expect(within(leases).getByRole('link', { name: 'Maponya Square' })).toHaveAttribute('href', `/properties/${lease.propertyId}`)
    expect(await within(leases).findByText('Naledi van der Merwe')).toBeInTheDocument()
  })

  it('offers no changes to members who only read', async () => {
    viewer.writer = false
    await renderScreen({ ...TENANT, whatsappVerified: false })
    await screen.findByRole('table', { name: 'Statements of Soweto Shoes' })
    for (const name of ['Edit', 'Validate number']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('opens the edit form for writers', async () => {
    await renderScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Edit Soweto Shoes' })).toBeInTheDocument()
  })
})
