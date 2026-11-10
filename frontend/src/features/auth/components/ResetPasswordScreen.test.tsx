import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPasswordSetup, markPasswordSetup } from '@/services/api/authCallback'
import { resetAppApi } from '@/test/appApi'
import { signedInAuth, signedOutAuth } from '@/test/authFixtures'
import { renderApp } from '@/test/renderApp'

import { PasswordChangeError } from '../passwordChange'

vi.mock('@/services/api/client', async () => ({ getApiClient: (await import('@/test/appApi')).appApiClient }))

beforeEach(() => {
  resetAppApi()
  clearPasswordSetup()
})
afterEach(() => clearPasswordSetup())

describe('/auth/reset-password', () => {
  it('sets a new password from the session a password link created and continues into the app', async () => {
    markPasswordSetup('recovery')
    const auth = signedInAuth()
    const { router } = await renderApp('/auth/reset-password', { auth })
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument()
    expect(screen.getByText('Choose a new password for sipho.dlamini@nexussolution.co.za.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/^New password/), 'short')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'shorter')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument()
    expect(auth.setPassword).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText(/^New password/))
    await userEvent.type(screen.getByLabelText(/^New password/), 'new-password-1')
    await userEvent.clear(screen.getByLabelText(/Confirm new password/))
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'new-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(auth.setPassword).toHaveBeenCalledWith('new-password-1')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('asks for a new link when Supabase no longer accepts the session', async () => {
    markPasswordSetup('recovery')
    const auth = signedInAuth()
    auth.setPassword.mockRejectedValueOnce(new PasswordChangeError('For your security, this link has expired. Request a new password link and try again.'))
    await renderApp('/auth/reset-password', { auth })
    await userEvent.type(await screen.findByLabelText(/^New password/), 'new-password-1')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'new-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText(/Request a new password link and try again/)).toBeInTheDocument()
  })

  it('sends a signed-in user with a used link back to the account menu', async () => {
    await renderApp('/auth/reset-password', { auth: signedInAuth() })
    expect(await screen.findByRole('heading', { name: 'This password link was already used' })).toBeInTheDocument()
    expect(screen.getByText(/open the account menu and choose Change password/)).toBeInTheDocument()
  })

  it('offers a new link to a signed-out user whose link is invalid or expired', async () => {
    await renderApp('/auth/reset-password', { auth: signedOutAuth() })
    expect(await screen.findByRole('heading', { name: 'This password link is invalid or has expired' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/auth/forgot-password')
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })
})
