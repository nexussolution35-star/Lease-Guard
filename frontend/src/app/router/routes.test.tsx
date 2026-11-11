import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthContextValue } from '@/features/auth/authContext'
import { membership, NEXUS_ID, profileWith, resetWorkspace } from '@/test/accountFixtures'
import { appApi, resetAppApi, respondWith } from '@/test/appApi'
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

  it('links the Communications sections to each other, analytics included', async () => {
    await renderApp('/communications')
    const sections = await screen.findByRole('navigation', { name: 'Communications' })
    expect(within(sections).getByRole('link', { name: 'Messages', current: 'page' })).toBeInTheDocument()
    expect(within(sections).getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/communications/approvals')
    const analytics = within(sections).getByRole('link', { name: 'Analytics' })
    expect(analytics).toHaveAttribute('href', '/communications/analytics')
    expect(analytics).not.toHaveAttribute('aria-current')
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

describe('settings (module 1)', () => {
  const COMPANY = {
    id: NEXUS_ID,
    name: 'Test Properties (Pty) Ltd',
    tradingName: 'Test Properties',
    address: { line1: '10 Test Street', suburb: 'Rosebank', city: 'Johannesburg', province: 'Gauteng', postalCode: '2196', country: 'South Africa' },
    contactEmail: 'office@test.co.za',
    contactPhone: '+27 11 555 0100',
    status: 'active',
    initials: 'TP',
    whatsapp: { connectionStatus: 'not_configured', numberCount: 0, connectedNumberCount: 0 },
    settings: {
      leaseExpiryNoticeDays: [180, 90, 30],
      renewalDeadlineWarningDays: [90, 30],
      guaranteeExpiryNoticeDays: [60, 30],
      paymentReminderOffsetsDays: { initial: 7, overdue: 14, followUp: 21 },
      installmentReminderLeadDays: 3,
      ownerSummaryWeekday: 'monday',
      timezone: 'Africa/Johannesburg',
    },
    createdAt: '2026-10-01T08:00:00+02:00',
    updatedAt: '2026-10-01T08:00:00+02:00',
  }
  const AUDIT_ENTRY = {
    id: 'e0000000-0000-4000-8000-000000000001',
    companyId: NEXUS_ID,
    action: 'verify',
    entityType: 'lease',
    entityId: 'a1b2c3d4-0000-4000-8000-0000000000aa',
    summary: 'Lease LSE-0042 verified',
    occurredAt: '2026-11-10T09:15:00+02:00',
    createdAt: '2026-11-10T09:15:00+02:00',
    updatedAt: '2026-11-10T09:15:00+02:00',
  }
  const emptyPage = { items: [], total: 0, page: 1, pageSize: 25 }

  function signInAs(role: 'company_admin' | 'property_manager' | 'property_owner' | 'read_only') {
    respondWith('GET', '/api/v1/me', 200, profileWith([membership(NEXUS_ID, { isDefault: true, role, name: COMPANY.name, initials: 'TP' })]))
  }

  beforeEach(() => {
    respondWith('GET', `/api/v1/companies/${NEXUS_ID}`, 200, COMPANY)
    respondWith('GET', '/api/v1/users', 200, emptyPage)
    respondWith('GET', '/api/v1/audit-logs', 200, { ...emptyPage, items: [AUDIT_ENTRY], total: 1 })
  })

  it('lets a company admin edit the company, and sends the active company with the request', async () => {
    signInAs('company_admin')
    await renderApp('/settings/company')
    const form = await screen.findByRole('form', { name: 'Company details' })
    expect(within(form).getByLabelText(/Registered name/)).toHaveValue('Test Properties (Pty) Ltd')
    const request = appApi.requests.find((r) => new URL(r.url).pathname === `/api/v1/companies/${NEXUS_ID}`)
    expect(request?.headers.get('x-company-id')).toBe(NEXUS_ID)
  })

  it('shows the company read-only to a property manager', async () => {
    signInAs('property_manager')
    await renderApp('/settings/company')
    expect(await screen.findByText(/Only company admins can change them/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Company details' })).not.toBeInTheDocument()
  })

  it('shows notice periods and reminder timing', async () => {
    signInAs('read_only')
    await renderApp('/settings/notifications')
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    expect(await screen.findByText('180, 90, 30 days before')).toBeInTheDocument()
  })

  it('explains the roles and marks the signed-in user’s role', async () => {
    signInAs('read_only')
    await renderApp('/settings/roles')
    expect(await screen.findByRole('heading', { level: 1, name: 'Roles' })).toBeInTheDocument()
    expect(await screen.findByRole('columnheader', { name: /Read only\s*\(your role\)/ })).toBeInTheDocument()
  })

  it('shows the audit log to an audit reader', async () => {
    signInAs('read_only')
    await renderApp('/settings/audit?action=verify')
    expect(await screen.findByText('Lease LSE-0042 verified')).toBeInTheDocument()
    const request = appApi.requests.find((r) => new URL(r.url).pathname === '/api/v1/audit-logs')
    expect(new URL(request?.url ?? 'http://x').searchParams.get('action')).toBe('verify')
  })

  it('does not ask the API for the audit log as a property owner', async () => {
    signInAs('property_owner')
    await renderApp('/settings/audit')
    expect(await screen.findByText('The audit log is not available for your role')).toBeInTheDocument()
    expect(appApi.requests.some((r) => new URL(r.url).pathname === '/api/v1/audit-logs')).toBe(false)
  })

  it('has no placeholder left on the module 1 settings screens', async () => {
    signInAs('company_admin')
    for (const path of ['/settings/company', '/settings/notifications', '/settings/roles', '/settings/audit', '/settings/users']) {
      const view = await renderApp(path)
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByText('Screen coming in the next stage')).not.toBeInTheDocument()
      view.unmount()
    }
  })
})
