import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace, TEST_USER_ID } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CompanyInvitation, CompanyMember, UserSource } from '../api/source'
import { UsersSettingsScreen } from './UsersSettingsScreen'

const fakeSource = vi.hoisted(() => ({
  listMembers: vi.fn<UserSource['listMembers']>(),
  updateMemberRole: vi.fn<UserSource['updateMemberRole']>(),
  removeMember: vi.fn<UserSource['removeMember']>(),
  listInvitations: vi.fn<UserSource['listInvitations']>(),
  createInvitation: vi.fn<UserSource['createInvitation']>(),
  revokeInvitation: vi.fn<UserSource['revokeInvitation']>(),
  resendInvitation: vi.fn<UserSource['resendInvitation']>(),
}))
vi.mock('../api/apiSource', () => ({ createApiUserSource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyAdmin: () => viewer.admin,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const NALEDI_ID = '5b0c1d2e-0000-4000-8000-0000000000a2'
const THABO_ID = '5b0c1d2e-0000-4000-8000-0000000000a3'

function member(id: string, fullName: string, email: string, role: CompanyMember['memberships'][number]['role'], status: CompanyMember['status'] = 'active'): CompanyMember {
  return {
    id,
    fullName,
    email,
    status,
    memberships: [{ companyId: NEXUS_ID, role, isDefault: true, joinedAt: '2026-10-01T08:00:00+02:00' }],
    createdAt: '2026-10-01T08:00:00+02:00',
    updatedAt: '2026-10-01T08:00:00+02:00',
  } as CompanyMember
}

const ME = member(TEST_USER_ID, 'Sipho Dlamini', 'sipho.dlamini@nexussolution.co.za', 'company_admin')
const NALEDI = member(NALEDI_ID, 'Naledi van der Merwe', 'naledi@example.co.za', 'property_manager')
const THABO = member(THABO_ID, 'Thabo Nkosi', 'thabo@example.co.za', 'read_only', 'suspended')

function invitation(id: string, email: string, status: CompanyInvitation['status'], extra: Partial<CompanyInvitation> = {}): CompanyInvitation {
  return {
    id,
    companyId: NEXUS_ID,
    email,
    role: 'property_manager',
    status,
    createdAt: '2026-11-09T08:00:00+02:00',
    updatedAt: '2026-11-09T08:00:00+02:00',
    ...extra,
  }
}

const SENT = invitation('9a000000-0000-4000-8000-000000000001', 'lerato@example.co.za', 'sent', { sentAt: '2026-11-09T08:05:00+02:00' })
const FAILED = invitation('9a000000-0000-4000-8000-000000000002', 'pieter@example.co.za', 'failed', { failureReason: 'The email address was rejected' })
const ACCEPTED = invitation('9a000000-0000-4000-8000-000000000003', 'zanele@example.co.za', 'accepted')

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 })

async function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <UsersSettingsScreen />
      <Toaster />
    </QueryClientProvider>,
    '/settings/users',
  )
}

function membersTable() {
  return screen.findByRole('table', { name: 'Members of this workspace' })
}

async function memberRow(name: string) {
  return within(await membersTable()).findByRole('row', { name: new RegExp(name) })
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.admin = true
  for (const fn of Object.values(fakeSource)) fn.mockReset()
  fakeSource.listMembers.mockImplementation(async (_companyId, params) =>
    params.role === 'company_admin' ? { ...page([ME]), total: 2 } : page([ME, NALEDI, THABO]),
  )
  fakeSource.listInvitations.mockResolvedValue(page([SENT, FAILED, ACCEPTED]))
})

describe('UsersSettingsScreen', () => {
  it('lists members with their role and status, marking the signed-in user', async () => {
    await renderScreen()
    const naledi = await memberRow('Naledi van der Merwe')
    expect(within(naledi).getByText('naledi@example.co.za')).toBeInTheDocument()
    expect(within(naledi).getByText('Property manager')).toBeInTheDocument()
    expect(within(naledi).getByText('Active')).toBeInTheDocument()
    expect(within(await memberRow('Thabo Nkosi')).getByText('Suspended')).toBeInTheDocument()
    expect(within(await memberRow('Sipho Dlamini')).getByText('You')).toBeInTheDocument()
  })

  it('disables role change and removal for yourself, and says why', async () => {
    await renderScreen()
    const me = await memberRow('Sipho Dlamini')
    expect(within(me).getByRole('button', { name: 'Change role for Sipho Dlamini' })).toBeDisabled()
    expect(within(me).getByRole('button', { name: 'Remove Sipho Dlamini' })).toBeDisabled()
    expect(within(me).getByText(/You cannot change your own role or remove yourself/)).toBeInTheDocument()
    expect(within(await memberRow('Naledi van der Merwe')).getByRole('button', { name: 'Remove Naledi van der Merwe' })).toBeEnabled()
  })

  it('protects the last active company admin', async () => {
    const other = member(NALEDI_ID, 'Naledi van der Merwe', 'naledi@example.co.za', 'company_admin')
    fakeSource.listMembers.mockImplementation(async (_companyId, params) => (params.role === 'company_admin' ? page([other]) : page([ME, other])))
    await renderScreen()
    const naledi = await memberRow('Naledi van der Merwe')
    expect(await within(naledi).findByText(/must keep at least one active company admin/)).toBeInTheDocument()
    expect(within(naledi).getByRole('button', { name: 'Remove Naledi van der Merwe' })).toBeDisabled()
  })

  it('changes another member’s role', async () => {
    fakeSource.updateMemberRole.mockResolvedValue(member(NALEDI_ID, 'Naledi van der Merwe', 'naledi@example.co.za', 'read_only'))
    await renderScreen()
    await userEvent.click(within(await memberRow('Naledi van der Merwe')).getByRole('button', { name: 'Change role for Naledi van der Merwe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change role for Naledi van der Merwe' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Role/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Read only' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role' }))
    expect(fakeSource.updateMemberRole).toHaveBeenCalledWith(NEXUS_ID, NALEDI_ID, 'read_only')
    expect(await screen.findByText('Naledi van der Merwe is now Read only.')).toBeInTheDocument()
  })

  it('explains a refused role change (409 last admin) and keeps the dialog open', async () => {
    fakeSource.updateMemberRole.mockRejectedValue(new ApiError(409, [], null))
    await renderScreen()
    await userEvent.click(within(await memberRow('Naledi van der Merwe')).getByRole('button', { name: 'Change role for Naledi van der Merwe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change role for Naledi van der Merwe' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Role/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Company admin' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role' }))
    expect(await within(dialog).findByText(/must keep at least one active company admin/)).toBeInTheDocument()
  })

  it('removes another member after confirmation', async () => {
    fakeSource.removeMember.mockResolvedValue(undefined)
    await renderScreen()
    await userEvent.click(within(await memberRow('Naledi van der Merwe')).getByRole('button', { name: 'Remove Naledi van der Merwe' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Naledi van der Merwe?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove member' }))
    expect(fakeSource.removeMember).toHaveBeenCalledWith(NEXUS_ID, NALEDI_ID)
    expect(await screen.findByText('Naledi van der Merwe was removed from this workspace.')).toBeInTheDocument()
  })

  it('shows why a removal was refused (403 for yourself or 409 for records still naming the member)', async () => {
    fakeSource.removeMember.mockRejectedValue(
      new ApiError(409, ['This member is still assigned to company records (for example as a property manager or lease verifier); reassign those records first'], null),
    )
    await renderScreen()
    await userEvent.click(within(await memberRow('Naledi van der Merwe')).getByRole('button', { name: 'Remove Naledi van der Merwe' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove member' }))
    expect(await screen.findByText('Could not remove the member')).toBeInTheDocument()
    expect(screen.getByText(/still assigned to company records/)).toBeInTheDocument()
  })

  it('lists invitations with their status and only the actions each status allows', async () => {
    await renderScreen()
    const table = await screen.findByRole('table', { name: 'Invitations to this workspace' })
    const sent = within(table).getByRole('row', { name: /lerato@example.co.za/ })
    expect(within(sent).getByText('Sent')).toBeInTheDocument()
    expect(within(sent).getByRole('button', { name: 'Resend invitation to lerato@example.co.za' })).toBeEnabled()
    expect(within(sent).getByRole('button', { name: 'Revoke invitation to lerato@example.co.za' })).toBeEnabled()
    const failed = within(table).getByRole('row', { name: /pieter@example.co.za/ })
    expect(within(failed).getByText('The email address was rejected')).toBeInTheDocument()
    expect(within(failed).getByRole('button', { name: 'Resend invitation to pieter@example.co.za' })).toBeEnabled()
    expect(within(failed).getByRole('button', { name: 'Revoke invitation to pieter@example.co.za' })).toBeDisabled()
    const accepted = within(table).getByRole('row', { name: /zanele@example.co.za/ })
    expect(within(accepted).getByRole('button', { name: 'Resend invitation to zanele@example.co.za' })).toBeDisabled()
  })

  it('invites someone and confirms the outcome', async () => {
    fakeSource.createInvitation.mockResolvedValue(invitation('9a000000-0000-4000-8000-000000000009', 'new.person@example.co.za', 'pending'))
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Invite user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' })
    await userEvent.type(within(dialog).getByLabelText(/Email address/), '  New.Person@Example.co.za ')
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'New Person')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(fakeSource.createInvitation).toHaveBeenCalledWith(NEXUS_ID, { email: 'new.person@example.co.za', fullName: 'New Person', role: 'property_manager' })
    expect(await screen.findByText(/Invitation for new.person@example.co.za created/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Invite user' })).not.toBeInTheDocument()
  })

  it('shows a conflicting invitation on the email field', async () => {
    fakeSource.createInvitation.mockRejectedValue(new ApiError(409, ['This email already has an open invitation to the company; resend or revoke it instead'], null))
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Invite user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' })
    await userEvent.type(within(dialog).getByLabelText(/Email address/), 'lerato@example.co.za')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(await within(dialog).findByText(/already has an open invitation/)).toBeInTheDocument()
  })

  it('resends and revokes invitations with clear outcomes', async () => {
    fakeSource.resendInvitation.mockResolvedValue(FAILED)
    fakeSource.revokeInvitation.mockResolvedValue({ ...SENT, status: 'revoked' })
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Resend invitation to pieter@example.co.za' }))
    expect(fakeSource.resendInvitation).toHaveBeenCalledWith(NEXUS_ID, FAILED.id)
    expect(await screen.findByText('The invitation to pieter@example.co.za will be sent again shortly.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Revoke invitation to lerato@example.co.za' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke invitation' }))
    expect(fakeSource.revokeInvitation).toHaveBeenCalledWith(NEXUS_ID, SENT.id)
    expect(await screen.findByText('The invitation to lerato@example.co.za was revoked. It can no longer be accepted.')).toBeInTheDocument()
  })

  it('explains a revoke that conflicts with the invitation’s new state', async () => {
    fakeSource.revokeInvitation.mockRejectedValue(new ApiError(409, ['Only a pending or sent invitation can be revoked (this one is accepted)'], null))
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke invitation to lerato@example.co.za' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke invitation' }))
    expect(await screen.findByText(/this one is accepted\)\. The list has been refreshed\./)).toBeInTheDocument()
  })

  it('shows other members a read-only list without invitations', async () => {
    viewer.admin = false
    await renderScreen()
    expect(await screen.findByText(/Only company admins can invite people, change roles or remove members/)).toBeInTheDocument()
    await memberRow('Naledi van der Merwe')
    expect(screen.queryByRole('button', { name: /Change role for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Invitations to this workspace' })).not.toBeInTheDocument()
    expect(fakeSource.listInvitations).not.toHaveBeenCalled()
  })

  it('shows an error with a retry when members cannot be loaded', async () => {
    let failNextList = true
    fakeSource.listMembers.mockImplementation(async (_companyId, params) => {
      if (params.role === 'company_admin') return { ...page([ME]), total: 2 }
      if (failNextList) {
        failNextList = false
        throw new ApiError(500, ['boom'], null)
      }
      return page([ME, NALEDI, THABO])
    })
    await renderScreen()
    expect(await screen.findByText('Could not load the members')).toBeInTheDocument()
    expect(screen.getByText('Try again in a moment.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    await memberRow('Naledi van der Merwe')
  })

  it('shows a forbidden message when the invitations are refused (403)', async () => {
    fakeSource.listInvitations.mockRejectedValue(new ApiError(403, ['Your role cannot do this in the active company'], null))
    await renderScreen()
    expect(await screen.findByText('Could not load the invitations')).toBeInTheDocument()
    expect(screen.getByText('Your role cannot do this in the active company.')).toBeInTheDocument()
  })

  it('says when there are no invitations yet', async () => {
    fakeSource.listInvitations.mockResolvedValue(page([]))
    await renderScreen()
    expect(await screen.findByText('No invitations yet')).toBeInTheDocument()
  })
})
