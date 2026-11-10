import { createApiClient, unwrap } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, integration, world } from './support/clients.ts'

describe('authentication', () => {
  it('serves readiness without authentication once Supabase and Redis are reachable', async () => {
    const response = await fetch(`${integration().apiBaseUrl}/health/ready`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ready' })
  })

  it('rejects GET /me without a bearer token (401)', async () => {
    const error = await apiErrorOf(unwrap(apiAs(null).GET('/api/v1/me')))
    expect(error.status).toBe(401)
  })

  it('rejects a company route without a bearer token (401), even with X-Company-Id', async () => {
    const error = await apiErrorOf(unwrap(apiAs(null, 'a').GET('/api/v1/properties', { params: { query: {} } })))
    expect(error.status).toBe(401)
  })

  it('rejects a malformed bearer token (401)', async () => {
    const api = createApiClient({ baseUrl: integration().apiBaseUrl, getAccessToken: () => 'not-a-valid-jwt' })
    const error = await apiErrorOf(unwrap(api.GET('/api/v1/me')))
    expect(error.status).toBe(401)
  })

  it('GET /me returns the signed-in user with every company membership', async () => {
    const { users, companies } = world()
    const me = await unwrap(apiAs('manager').GET('/api/v1/me'))
    expect(me.id).toBe(users.manager.id)
    expect(me.email).toBe(users.manager.email)
    expect(me.fullName).toBe(users.manager.fullName)

    const memberships = [...me.memberships].sort((a, b) => a.company.name.localeCompare(b.company.name))
    expect(memberships.map((m) => ({ companyId: m.companyId, role: m.role, name: m.company.name }))).toEqual([
      { companyId: companies.a.id, role: 'property_manager', name: companies.a.name },
      { companyId: companies.b.id, role: 'property_manager', name: companies.b.name },
    ])
    expect(memberships.filter((m) => m.isDefault).map((m) => m.companyId)).toEqual([companies.a.id])
  })

  it('GET /me lists only the companies a single-company user belongs to', async () => {
    const me = await unwrap(apiAs('admin').GET('/api/v1/me'))
    expect(me.memberships.map((m) => [m.companyId, m.role])).toEqual([[world().companies.a.id, 'company_admin']])
  })
})
