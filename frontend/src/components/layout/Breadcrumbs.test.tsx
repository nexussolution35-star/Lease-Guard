import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NEXUS_ID, openWorkspace } from '@/test/accountFixtures'
import { fakeApiClient, jsonResponse, sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import { Breadcrumbs } from './Breadcrumbs'
import { renderWithRouter } from './testRouter'

const ID = {
  property: 'a1b2c3d4-0000-5000-8000-000000000001',
  unit: 'a1b2c3d4-0000-5000-8000-000000000002',
  tenant: 'a1b2c3d4-0000-5000-8000-000000000003',
  lease: 'a1b2c3d4-0000-5000-8000-000000000004',
  statement: 'a1b2c3d4-0000-5000-8000-000000000005',
  event: 'a1b2c3d4-0000-5000-8000-000000000006',
  arrangement: 'a1b2c3d4-0000-5000-8000-000000000007',
  arrangementTenant: 'a1b2c3d4-0000-5000-8000-000000000008',
}

const records: Readonly<Record<string, unknown>> = {
  [`/api/v1/properties/${ID.property}`]: { ...sampleRecord('properties'), id: ID.property, name: 'Riverside Mall' },
  [`/api/v1/units/${ID.unit}`]: { ...sampleRecord('units'), id: ID.unit, unitNumber: 'G12' },
  [`/api/v1/tenants/${ID.tenant}`]: { ...sampleRecord('tenants'), id: ID.tenant, tradingName: 'Karoo Coffee' },
  [`/api/v1/tenants/${ID.arrangementTenant}`]: { ...sampleRecord('tenants'), id: ID.arrangementTenant, tradingName: 'Baobab Books' },
  [`/api/v1/leases/${ID.lease}`]: { ...sampleRecord('leases'), id: ID.lease, reference: 'LSE-2026-014' },
  [`/api/v1/statements/${ID.statement}`]: { ...sampleRecord('statements'), id: ID.statement, statementNumber: 'STM-0042' },
  [`/api/v1/monitoring/events/${ID.event}`]: { ...sampleRecord('monitoringEvents'), id: ID.event, title: 'Escalation due' },
  [`/api/v1/arrangements/${ID.arrangement}`]: {
    ...sampleRecord('paymentArrangements'),
    id: ID.arrangement,
    tenantId: ID.arrangementTenant,
  },
}

const requests: string[] = []

vi.mock('@/services/api/client', () => ({
  getApiClient: () =>
    fakeApiClient(
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const { pathname } = new URL((input as Request).url)
        requests.push(pathname)
        const body = records[pathname]
        return body === undefined
          ? jsonResponse(404, { statusCode: 404, error: 'Not Found', message: 'Not found', requestId: null })
          : jsonResponse(200, body)
      }),
    ),
}))

beforeEach(() => {
  localStorage.clear()
  openWorkspace(NEXUS_ID)
  requests.length = 0
})

/** Renders the route trail at `path` and waits for its last (current-page) crumb to read `label`. */
async function renderTrail(path: string, items?: Parameters<typeof Breadcrumbs>[0]['items']) {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <Breadcrumbs {...(items ? { items } : {})} />
    </QueryClientProvider>,
    path,
  )
}

async function expectCurrentCrumb(path: string, label: string): Promise<void> {
  await renderTrail(path)
  const nav = await screen.findByRole('navigation', { name: /breadcrumb/i })
  expect(await within(nav).findByText(label)).toHaveAttribute('aria-current', 'page')
}

describe('Breadcrumbs', () => {
  it('derives the trail from the current route', async () => {
    await renderTrail('/statements/upload')
    const nav = await screen.findByRole('navigation', { name: /breadcrumb/i })
    expect(within(nav).getByRole('link', { name: 'Statements' })).toHaveAttribute('href', '/statements')
    expect(within(nav).getByText('Upload')).toHaveAttribute('aria-current', 'page')
  })

  it('renders an explicit trail', async () => {
    await renderTrail('/', [{ label: 'Leases', to: '/leases' }, { label: 'LSE-001' }])
    expect(await screen.findByRole('link', { name: 'Leases' })).toHaveAttribute('href', '/leases')
    expect(screen.getByText('LSE-001')).toBeInTheDocument()
  })


  it.each([
    ['properties', ID.property, 'Riverside Mall'],
    ['units', ID.unit, 'Unit G12'],
    ['tenants', ID.tenant, 'Karoo Coffee'],
    ['leases', ID.lease, 'LSE-2026-014'],
    ['statements', ID.statement, 'STM-0042'],
    ['monitoring', ID.event, 'Escalation due'],
    ['arrangements', ID.arrangement, 'Baobab Books arrangement'],
  ])('resolves the %s detail record name instead of showing its id', async (section, id, label) => {
    await expectCurrentCrumb(`/${section}/${id}`, label)
  })

  it('only requests the record of the section on screen', async () => {
    await expectCurrentCrumb(`/leases/${ID.lease}`, 'LSE-2026-014')
    expect(requests).toEqual([`/api/v1/leases/${ID.lease}`])
  })
})
