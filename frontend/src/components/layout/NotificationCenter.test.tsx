import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NEXUS_ID, openWorkspace } from '@/test/accountFixtures'
import { jsonResponse, fakeApiClient, sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import { NotificationCenter } from './NotificationCenter'
import { renderWithRouter } from './testRouter'

const requests: Request[] = []
let unread = 2

const unreadNotification = { ...sampleRecord('notifications'), id: 'a1b2c3d4-0000-5000-8000-000000000001', title: 'Statement needs review', read: false }
const readNotification = { ...unreadNotification, id: 'a1b2c3d4-0000-5000-8000-000000000002', title: 'Arrangement updated', read: true }

/** A tiny fake of the notifications endpoints. */
function respond(request: Request): Response {
  requests.push(request)
  const url = new URL(request.url)
  if (request.method === 'POST' && url.pathname === '/api/v1/notifications/read-all') {
    const updated = unread
    unread = 0
    return jsonResponse(200, { updated })
  }
  if (request.method === 'POST' && url.pathname.endsWith('/read')) {
    unread = Math.max(0, unread - 1)
    return jsonResponse(200, { ...unreadNotification, read: true })
  }
  if (url.searchParams.get('unreadOnly') === 'true') return jsonResponse(200, { items: [], total: unread, page: 1, pageSize: 1 })
  return jsonResponse(200, { items: [{ ...unreadNotification, read: unread === 0 }, readNotification], total: 2, page: 1, pageSize: 20 })
}

vi.mock('@/services/api/client', () => ({
  getApiClient: () => fakeApiClient(vi.fn<typeof globalThis.fetch>(async (input) => respond(input as Request))),
}))

beforeEach(() => {
  localStorage.clear()
  openWorkspace(NEXUS_ID)
  requests.length = 0
  unread = 2
})

function renderCentre() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <NotificationCenter />
    </QueryClientProvider>,
  )
}

describe('NotificationCenter', () => {
  it('shows the unread count for the active workspace without loading the list', async () => {
    await renderCentre()
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
    const companyId = NEXUS_ID
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.get('x-company-id')).toBe(companyId)
    expect(Object.fromEntries(new URL(requests[0]?.url ?? '').searchParams)).toEqual({ page: '1', pageSize: '1', unreadOnly: 'true' })
  })

  it('loads the newest notifications when opened and marks all read', async () => {
    await renderCentre()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    expect(await screen.findByText('Statement needs review')).toBeInTheDocument()
    expect(screen.getByText('Arrangement updated')).toBeInTheDocument()
    const listRequest = requests.find((r) => new URL(r.url).searchParams.get('pageSize') === '20')
    expect(Object.fromEntries(new URL(listRequest?.url ?? '').searchParams)).toEqual({ page: '1', pageSize: '20', sort: 'createdAt', direction: 'desc' })

    await userEvent.click(screen.getByRole('button', { name: /mark all read/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument())
    expect(requests.some((r) => r.method === 'POST' && new URL(r.url).pathname === '/api/v1/notifications/read-all')).toBe(true)
  })
})
