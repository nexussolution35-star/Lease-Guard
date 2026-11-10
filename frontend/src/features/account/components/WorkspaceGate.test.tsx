import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext } from '@/features/auth/authContext'
import { useAppStore } from '@/store/appStore'
import { membership, NEXUS_ID, openWorkspace, profileWith, resetWorkspace, SECOND_ID } from '@/test/accountFixtures'
import { signedInAuth } from '@/test/authFixtures'
import { fakeApiClient, jsonResponse } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import { WorkspaceGate } from './WorkspaceGate'

const respond = vi.fn<(request: Request) => Response>()

vi.mock('@/services/api/client', () => ({
  getApiClient: () => fakeApiClient(vi.fn<typeof globalThis.fetch>(async (input) => respond(input as Request))),
}))

function renderGate() {
  const auth = signedInAuth()
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={auth}>
        <WorkspaceGate>
          <p>Application shell</p>
        </WorkspaceGate>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
  return auth
}

/** Answers each request by its path (the no-workspace screen also loads `/me/invitations`). */
function respondByPath(bodies: Record<string, unknown>) {
  respond.mockImplementation((request) => {
    const path = new URL(request.url).pathname
    return path in bodies ? jsonResponse(200, bodies[path]) : jsonResponse(404, { statusCode: 404, error: 'Not Found', message: path, requestId: 'r0' })
  })
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  respond.mockReset()
})

describe('WorkspaceGate', () => {
  it('opens the default membership and then renders the application', async () => {
    respond.mockReturnValue(jsonResponse(200, profileWith([membership(SECOND_ID), membership(NEXUS_ID, { isDefault: true })])))
    renderGate()
    expect(await screen.findByText('Application shell')).toBeInTheDocument()
    expect(new URL(respond.mock.calls[0]?.[0].url ?? '').pathname).toBe('/api/v1/me')
    expect(useAppStore.getState().activeCompanyId).toBe(NEXUS_ID)
  })

  it('keeps an already open workspace the user is still a member of', async () => {
    openWorkspace(SECOND_ID)
    respond.mockReturnValue(jsonResponse(200, profileWith([membership(SECOND_ID), membership(NEXUS_ID, { isDefault: true })])))
    renderGate()
    expect(await screen.findByText('Application shell')).toBeInTheDocument()
    expect(useAppStore.getState().activeCompanyId).toBe(SECOND_ID)
  })

  it('leaves a workspace the user no longer belongs to', async () => {
    openWorkspace('9e8d7c6b-0000-5000-8000-00000000dead')
    respond.mockReturnValue(jsonResponse(200, profileWith([membership(NEXUS_ID, { isDefault: true })])))
    renderGate()
    expect(await screen.findByText('Application shell')).toBeInTheDocument()
    expect(useAppStore.getState().activeCompanyId).toBe(NEXUS_ID)
  })

  it('shows "No workspace yet" without memberships or invitations, with sign-out', async () => {
    respondByPath({ '/api/v1/me': profileWith([]), '/api/v1/me/invitations': [] })
    const auth = renderGate()
    expect(await screen.findByText('No workspace yet')).toBeInTheDocument()
    expect(await screen.findByText(/Ask your company administrator to invite you/)).toBeInTheDocument()
    expect(screen.queryByText('Your invitations')).not.toBeInTheDocument()
    expect(screen.queryByText('Application shell')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('lists pending invitations when the user has no memberships yet', async () => {
    respondByPath({
      '/api/v1/me': profileWith([]),
      '/api/v1/me/invitations': [
        {
          id: '5b1f7c2e-0000-4000-8000-000000000001',
          companyId: SECOND_ID,
          companyName: 'Second Company',
          role: 'property_manager',
          invitedByName: 'Thandi Nkosi',
          createdAt: '2026-11-01T09:00:00+02:00',
        },
      ],
    })
    renderGate()
    expect(await screen.findByText('Your invitations')).toBeInTheDocument()
    expect(screen.getByText('Second Company')).toBeInTheDocument()
    expect(screen.getByText(/Accept an invitation to get started/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.queryByText('Application shell')).not.toBeInTheDocument()
  })

  it('treats a missing LeaseGuard profile (404) as no access', async () => {
    respond.mockReturnValue(jsonResponse(404, { statusCode: 404, error: 'Not Found', message: 'Profile not found', requestId: 'r1' }))
    renderGate()
    expect(await screen.findByText(/has no LeaseGuard user profile/)).toBeInTheDocument()
  })

  it('shows an error with retry when /me fails, and recovers on retry', async () => {
    respond.mockReturnValueOnce(jsonResponse(500, { statusCode: 500, error: 'Internal Server Error', message: 'Database unavailable', requestId: 'r2' }))
    renderGate()
    expect(await screen.findByText('Your account could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()

    respond.mockReturnValue(jsonResponse(200, profileWith([membership(NEXUS_ID, { isDefault: true })])))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Application shell')).toBeInTheDocument()
  })

  it('signs out when /me answers 401', async () => {
    respond.mockReturnValue(jsonResponse(401, { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired access token', requestId: 'r3' }))
    const auth = renderGate()
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
    expect(screen.queryByText('Application shell')).not.toBeInTheDocument()
  })
})
