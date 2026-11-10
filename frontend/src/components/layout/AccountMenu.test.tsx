import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '@/components/ui/sonner'
import { accountKeys } from '@/features/account/api/queries'
import { AuthContext } from '@/features/auth/authContext'
import { PasswordLinkError } from '@/features/auth/passwordChange'
import { useAppStore } from '@/store/appStore'
import { membership, NEXUS_ID, openWorkspace, profileWith, resetWorkspace, SECOND_ID, TEST_USER_ID } from '@/test/accountFixtures'
import { appApi, resetAppApi, respondWith } from '@/test/appApi'
import { signedInAuth } from '@/test/authFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import { AccountMenu } from './AccountMenu'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

vi.mock('@/services/api/client', async () => ({ getApiClient: (await import('@/test/appApi')).appApiClient }))

const profile = {
  ...profileWith([
    membership(NEXUS_ID, { name: 'Test Properties (Pty) Ltd', tradingName: 'Test Properties', initials: 'TP', role: 'property_manager', isDefault: true }),
    membership(SECOND_ID, { name: 'Acacia Property Group', initials: 'AP', role: 'read_only' }),
  ]),
  phone: '011 555 0100',
  whatsappNumber: '+27821234567',
  jobTitle: 'Portfolio manager',
}

function renderWithProfile(ui: ReactNode, user = profile) {
  const client = createTestQueryClient()
  respondWith('GET', '/api/v1/me', 200, user)
  // `/me` already loaded by the workspace gate (and fresh, so mounting does not refetch it).
  client.setQueryDefaults(accountKeys.all, { staleTime: Infinity })
  client.setQueryData(accountKeys.currentUser(TEST_USER_ID), user)
  const auth = signedInAuth()
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        {ui}
        <Toaster />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
  return { auth, client }
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Account menu for Sipho Dlamini' }))
  return screen.findByRole('menu')
}

beforeEach(() => {
  localStorage.clear()
  resetAppApi()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
})

describe('AccountMenu', () => {
  it('shows the signed-in user’s name, email and role in the active workspace, and signs out', async () => {
    const { auth } = renderWithProfile(<AccountMenu />)
    expect(screen.getByRole('button', { name: 'Account menu for Sipho Dlamini' })).toHaveTextContent('Property manager')

    const menu = await openMenu()
    expect(within(menu).getByText('sipho.dlamini@nexussolution.co.za')).toBeInTheDocument()
    expect(within(menu).getByText('Property manager · Test Properties')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Edit profile' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Change password' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Theme' })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('switches workspace from the menu when the user has more than one', async () => {
    renderWithProfile(<AccountMenu />)
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Switch workspace' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Acacia Property Group/ }))
    expect(useAppStore.getState().activeCompanyId).toBe(SECOND_ID)
    expect(await screen.findByText('Switched to Acacia Property Group')).toBeInTheDocument()
  })

  it('offers no workspace switch with a single membership', async () => {
    renderWithProfile(<AccountMenu />, { ...profile, memberships: profile.memberships.slice(0, 1) })
    const menu = await openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Switch workspace' })).not.toBeInTheDocument()
  })
})

describe('Edit profile', () => {
  it('saves the profile through PATCH /me, clearing emptied fields, and refreshes the menu', async () => {
    const updated = { ...profile, fullName: 'Sipho M. Dlamini', jobTitle: undefined, whatsappNumber: '+27831234567' }
    renderWithProfile(<AccountMenu />)
    respondWith('PATCH', '/api/v1/me', 200, updated)
    respondWith('GET', '/api/v1/me', 200, updated)

    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Edit profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit profile' })
    const fullName = within(dialog).getByLabelText(/Full name/)
    expect(fullName).toHaveValue('Sipho Dlamini')
    await userEvent.clear(fullName)
    await userEvent.type(fullName, 'Sipho M. Dlamini')
    await userEvent.clear(within(dialog).getByLabelText('Job title'))
    const whatsapp = within(dialog).getByLabelText('WhatsApp number')
    await userEvent.clear(whatsapp)
    await userEvent.type(whatsapp, '083 123 4567')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Profile updated')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const patch = appApi.requests.find((r) => r.method === 'PATCH')
    expect(await patch?.json()).toEqual({ fullName: 'Sipho M. Dlamini', phone: '011 555 0100', whatsappNumber: '+27831234567', jobTitle: null })
    expect(screen.getByRole('button', { name: 'Account menu for Sipho M. Dlamini' })).toBeInTheDocument()
  })

  it('validates before sending and shows API errors', async () => {
    respondWith('PATCH', '/api/v1/me', 400, { statusCode: 400, error: 'Bad Request', message: 'whatsappNumber: must be an international number', requestId: 'r1' })
    renderWithProfile(<AccountMenu />)
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Edit profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit profile' })

    await userEvent.clear(within(dialog).getByLabelText(/Full name/))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('Enter your full name')).toBeInTheDocument()
    expect(appApi.requests.some((r) => r.method === 'PATCH')).toBe(false)

    await userEvent.type(within(dialog).getByLabelText(/Full name/), 'Sipho Dlamini')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('whatsappNumber: must be an international number')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit profile' })).toBeInTheDocument()
  })
})

describe('Edit profile after a cancelled attempt', () => {
  it('starts from the saved values again and accepts new input', async () => {
    renderWithProfile(<AccountMenu />)
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Edit profile' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit profile' })
    await userEvent.clear(within(dialog).getByLabelText('WhatsApp number'))
    await userEvent.type(within(dialog).getByLabelText('WhatsApp number'), '12345')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText(/international number/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    respondWith('PATCH', '/api/v1/me', 200, profile)
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Edit profile' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit profile' })
    const whatsapp = within(dialog).getByLabelText('WhatsApp number')
    expect(whatsapp).toHaveValue('+27 82 123 4567')
    await userEvent.clear(whatsapp)
    await userEvent.type(whatsapp, '083 555 0199')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const patches = appApi.requests.filter((r) => r.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect((await patches[0]?.json())?.whatsappNumber).toBe('+27835550199')
  })
})

describe('Change password', () => {
  async function openPasswordDialog() {
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Change password' }))
    return screen.findByRole('dialog', { name: 'Change password' })
  }

  it('emails a password link instead of asking for passwords, then offers a resend after a cooldown', async () => {
    const { auth } = renderWithProfile(<AccountMenu />)
    const dialog = await openPasswordDialog()
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument()
    expect(within(dialog).getByText('sipho.dlamini@nexussolution.co.za')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(auth.sendPasswordChangeLink).toHaveBeenCalledOnce()
    expect(await within(dialog).findByText('We sent a link to sipho.dlamini@nexussolution.co.za')).toBeInTheDocument()
    const resend = within(dialog).getByRole('button', { name: /^Resend link in \d+s$/ })
    expect(resend).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('shows a rate limit clearly and waits the time Supabase gives before allowing another request', async () => {
    const { auth } = renderWithProfile(<AccountMenu />)
    auth.sendPasswordChangeLink.mockRejectedValueOnce(new PasswordLinkError('A link was sent moments ago. You can request another in 30 seconds.', 30))
    const dialog = await openPasswordDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(await within(dialog).findByText('A link was sent moments ago. You can request another in 30 seconds.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^Send link in (30|29)s$/ })).toBeDisabled()
  })

  it('shows a safe message when the link cannot be sent and lets the user try again', async () => {
    const { auth } = renderWithProfile(<AccountMenu />)
    auth.sendPasswordChangeLink.mockRejectedValueOnce(new PasswordLinkError('The link could not be sent right now. Try again shortly.'))
    const dialog = await openPasswordDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(await within(dialog).findByText('The link could not be sent right now. Try again shortly.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(await within(dialog).findByText('We sent a link to sipho.dlamini@nexussolution.co.za')).toBeInTheDocument()
    expect(within(dialog).queryByText(/could not be sent/)).not.toBeInTheDocument()
  })
})

describe('WorkspaceSwitcher', () => {
  it('lists the user’s memberships with their role and marks the active one', async () => {
    renderWithProfile(<WorkspaceSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: 'Workspace: Test Properties. Switch workspace' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['APAcacia Property GroupRead only', 'TPTest PropertiesProperty manager'])
    expect(screen.getByLabelText('Active workspace')).toBeInTheDocument()
    expect(screen.queryByText(/reset demo data/i)).not.toBeInTheDocument()
  })
})
