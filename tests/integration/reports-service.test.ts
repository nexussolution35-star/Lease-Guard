import { unwrap } from '@leaseguard/api-client'
import { REPORT_CATALOGUE, reportCatalogueFor } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { apiErrorOf, gatewayAs, integration } from './support/clients.ts'

/**
 * The reports service (ADR 0003) on the local stack, reached through this run's gateway like the web app reaches it:
 * its own process, its own health, the Supabase JWT and the active company verified by the shared service kit.
 */
describe('reports service through the gateway', () => {
  it('answers its own liveness and readiness (Redis and Supabase up)', async () => {
    const { reportsBaseUrl } = integration()
    const live = await fetch(`${reportsBaseUrl}/health`)
    expect(live.status).toBe(200)
    const ready = await fetch(`${reportsBaseUrl}/health/ready`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toMatchObject({ status: 'ready', checks: { redis: { status: 'up' }, supabase: { status: 'up' } } })
  })

  it('serves the report catalogue at /api/v1/reports to every member role of the active company', async () => {
    const roles = { admin: 'company_admin', manager: 'property_manager', readOnly: 'read_only', owner: 'property_owner' } as const
    for (const [user, role] of Object.entries(roles) as [keyof typeof roles, (typeof roles)[keyof typeof roles]][]) {
      const catalogue = await unwrap(gatewayAs(user, 'a').GET('/api/v1/reports'))
      // Each role sees the reports it may open: the weekly owner summary is a company admin's (R-07).
      expect(catalogue.reports, user).toEqual(reportCatalogueFor(role).map((report) => ({ ...report })))
    }
    expect((await unwrap(gatewayAs('admin', 'a').GET('/api/v1/reports'))).reports).toHaveLength(REPORT_CATALOGUE.length)
  })

  it('is served by the reports service, not the core API', async () => {
    const { apiBaseUrl, accessTokens, world } = integration()
    const direct = await fetch(`${apiBaseUrl}/api/v1/reports`, {
      headers: { authorization: `Bearer ${accessTokens.admin}`, 'x-company-id': world.companies.a.id },
    })
    expect(direct.status).toBe(404)
  })

  it('verifies the access token and the company itself', async () => {
    expect((await apiErrorOf(unwrap(gatewayAs(null, 'a').GET('/api/v1/reports')))).status).toBe(401)
    expect((await apiErrorOf(unwrap(gatewayAs('admin').GET('/api/v1/reports')))).status).toBe(400)
    // The admin belongs to company A only.
    expect((await apiErrorOf(unwrap(gatewayAs('admin', 'b').GET('/api/v1/reports')))).status).toBe(403)

    const forged = await fetch(`${integration().gatewayBaseUrl}/api/v1/reports`, {
      headers: { authorization: 'Bearer not.a.jwt', 'x-company-id': integration().world.companies.a.id },
    })
    expect(forged.status).toBe(401)
  })

  it('still routes every other path to the core API', async () => {
    const me = await unwrap(gatewayAs('admin').GET('/api/v1/me'))
    expect(me.email).toBe(integration().world.users.admin.email)
    const health = await fetch(`${integration().gatewayBaseUrl}/health`)
    expect(health.status).toBe(200)
    // A path that only looks like the reports prefix is the core's (and unknown there).
    const lookalike = await fetch(`${integration().gatewayBaseUrl}/api/v1/reportsx`, {
      headers: { authorization: `Bearer ${integration().accessTokens.admin}` },
    })
    expect(lookalike.status).toBe(404)
  })

  it('never lets a response be stored', async () => {
    const response = await fetch(`${integration().gatewayBaseUrl}/api/v1/reports`, {
      headers: { authorization: `Bearer ${integration().accessTokens.admin}`, 'x-company-id': integration().world.companies.a.id },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
