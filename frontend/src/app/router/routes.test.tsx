import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthContextValue } from '@/features/auth/authContext'
import { resetWorkspace } from '@/test/accountFixtures'
import { resetAppApi, respondWith } from '@/test/appApi'
import { sampleRecord } from '@/test/fakeApi'
import { signedInAuth } from '@/test/authFixtures'
import { renderApp } from '@/test/renderApp'

vi.mock('@/services/api/client', async () => ({ getApiClient: (await import('@/test/appApi')).appApiClient }))

// Rendering the whole app loads every lazily split route chunk on first use, which can exceed the
// default 5 s under a fully parallel run.
vi.setConfig({ testTimeout: 20_000 })

const PROPERTY_ID = 'a1b2c3d4-0000-5000-8000-0000000000aa'

function signedOut(): AuthContextValue {
  return { ...signedInAuth(), status: 'unauthenticated', user: null }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  resetAppApi()
})

describe('route guard', () => {
  it('redirects signed-out users to /login, keeping the requested page', async () => {
    const { router } = await renderApp('/properties?page=2', { auth: signedOut() })
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/properties?page=2' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to LeaseGuard' })).toBeInTheDocument()
    // The login screen renders without the application shell.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('sends signed-in users away from /login to the requested page', async () => {
    const { router } = await renderApp('/login?redirect=%2Funits')
    expect(router.state.location.pathname).toBe('/units')
  })

  it('ignores external redirect targets after sign-in', async () => {
    const { router } = await renderApp('/login?redirect=https%3A%2F%2Fevil.example')
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('app routes', () => {
  it('renders a screen inside the application shell once the workspace is open', async () => {
    await renderApp('/leases')
    expect(await screen.findByRole('heading', { level: 1, name: 'Leases' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Leases', current: 'page' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Workspace: Test Properties. Switch workspace' })).toBeInTheDocument()
  })

  it('shows a detail record of the active workspace from the API', async () => {
    respondWith('GET', `/api/v1/properties/${PROPERTY_ID}`, 200, { ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Riverside Mall' })
    await renderApp(`/properties/${PROPERTY_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Riverside Mall' })).toBeInTheDocument()
  })

  it('shows not found for a record the active workspace does not have', async () => {
    await renderApp(`/properties/${PROPERTY_ID}`)
    expect(await screen.findByText('Property not found in this workspace')).toBeInTheDocument()
  })

  it('redirects /settings to /settings/company', async () => {
    const { router } = await renderApp('/settings')
    expect(router.state.location.pathname).toBe('/settings/company')
    expect(await screen.findByRole('heading', { level: 1, name: 'Company' })).toBeInTheDocument()
  })

  it('renders not found inside the shell for unknown paths', async () => {
    await renderApp('/does-not-exist')
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('renders a known report by id', async () => {
    await renderApp('/reports/arrears')
    expect(await screen.findByRole('heading', { level: 1, name: 'Arrears ageing' })).toBeInTheDocument()
  })

  it('shows not found for an unknown report id', async () => {
    await renderApp('/reports/not-a-report')
    expect(await screen.findByRole('heading', { level: 1, name: 'Report not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to reports' })).toHaveAttribute('href', '/reports')
  })
})
