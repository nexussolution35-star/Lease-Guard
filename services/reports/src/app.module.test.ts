import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { REPORT_CATALOGUE, REPORT_IDS } from '@leaseguard/domain'
import { COMPANY_ID_HEADER, configureServiceApp, RlsClientFactory } from '@leaseguard/service-kit'
import { fakeClients } from '@leaseguard/service-kit/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ReportsAppModule } from './app.module'
import { loadReportsEnv } from './config/env'
import { createReportsOpenApiDocument } from './openapi'

const USER_ID = '6f0c8e9a-6a43-4a8e-9d1f-2b7c1f1c0a01'
const COMPANY_ID = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
const OTHER_COMPANY_ID = '9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0'

/**
 * Boots the real ReportsAppModule (the service kit's guards, filter, health and database factory included), so a
 * missing provider or a broken import fails here. Supabase and Redis point at closed local ports: only the database
 * factory's two entry points are replaced, after injection, by the kit's fake (token claims and membership lookup).
 */
/** What the reporting functions return for the member's company (one property, two units, one account in arrears). */
const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'
const REPORT_ROWS: Record<string, unknown[]> = {
  reports_property_figures: [
    {
      property_id: PROPERTY_ID,
      property_name: 'Maponya Square',
      property_code: 'MSQ',
      property_status: 'active',
      unit_count: 2,
      occupied_units: 1,
      vacant_units: 1,
      active_leases: 1,
      unverified_leases: 0,
      monthly_rental_roll: '12960.00',
      open_events: 3,
    },
  ],
  reports_arrears_accounts: [
    { tenant_id: 't1', property_id: PROPERTY_ID, unit_id: 'u1', lease_id: null, statement_id: 's1', statement_date: '2026-10-31', outstanding: 4500.5 },
  ],
  reports_unit_occupancy: [
    {
      unit_id: 'u1',
      unit_number: 'S01',
      unit_type: 'line_shop',
      floor_area_sqm: 120,
      occupancy_status: 'occupied',
      property_id: PROPERTY_ID,
      property_name: 'Maponya Square',
      tenant_id: 't1',
      tenant_name: 'Dlamini Cellular',
      tenant_source: 'assignment',
      lease_id: null,
      lease_reference: null,
    },
    {
      unit_id: 'u2',
      unit_number: 'S02',
      unit_type: 'kiosk',
      floor_area_sqm: 10,
      occupancy_status: 'vacant',
      property_id: PROPERTY_ID,
      property_name: 'Maponya Square',
      tenant_id: null,
      tenant_name: null,
      tenant_source: null,
      lease_id: null,
      lease_reference: null,
    },
  ],
}

describe('reports service', () => {
  const rpcCalls: { fn: string; args: { p_company_id: string }; accessToken: string }[] = []
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    const env = loadReportsEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_ANON_KEY: 'test-anon-key',
      REDIS_URL: 'redis://127.0.0.1:9',
      REPORTS_PORT: '3100',
      REPORTS_CORS_ORIGINS: 'http://localhost:5173',
    })
    app = await NestFactory.create(ReportsAppModule.register(env), { logger: false })
    configureServiceApp(app, { corsOrigins: env.REPORTS_CORS_ORIGINS, openApiDocument: createReportsOpenApiDocument })

    const { factory } = fakeClients({
      getClaims: async (token) =>
        token === 'member.jwt' || token === 'outsider.jwt'
          ? { data: { claims: { role: 'authenticated', sub: USER_ID, email: 'pm@nexus.co.za' } }, error: null }
          : { data: null, error: new Error('invalid JWT') },
    })
    const real = app.get(RlsClientFactory)
    real.tokenVerifier = factory.tokenVerifier.bind(factory)
    // The membership answer depends on the company asked for, as RLS would answer it.
    real.forAccessToken = ((accessToken: string) => {
      const membership = (companyId: unknown) =>
        accessToken === 'member.jwt' && companyId === COMPANY_ID ? { data: { role: 'read_only' }, error: null } : { data: null, error: null }
      return {
        // The reporting functions, as the database answers a member (42501 for anyone else, as private.reports_require_member).
        rpc: async (fn: string, args: { p_company_id: string }) => {
          rpcCalls.push({ fn, args, accessToken })
          if (accessToken !== 'member.jwt' || args.p_company_id !== COMPANY_ID) {
            return { data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } }
          }
          return { data: REPORT_ROWS[fn] ?? [], error: null }
        },
        from: () => ({
          select: () => {
            let companyId: unknown
            const builder = {
              eq: (column: string, value: unknown) => {
                if (column === 'company_id') companyId = value
                return builder
              },
              maybeSingle: async () => membership(companyId),
            }
            return builder
          },
        }),
      }
    }) as unknown as RlsClientFactory['forAccessToken']

    await app.listen(0, '127.0.0.1')
    baseUrl = await app.getUrl()
  })

  afterAll(async () => {
    await app?.close()
  })

  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}${path}`, { headers })

  it('answers liveness at the root and reports itself not ready while its dependencies are down', async () => {
    const live = await get('/health')
    expect(live.status).toBe(200)
    expect(await live.json()).toMatchObject({ status: 'ok' })
    expect(live.headers.get('cache-control')).toContain('no-store')

    const ready = await get('/health/ready')
    expect(ready.status).toBe(503)
    expect(await ready.json()).toMatchObject({ status: 'not_ready', checks: { redis: { status: 'down' }, supabase: { status: 'down' } } })
  })

  it('serves the report catalogue to a member of the active company', async () => {
    const response = await get('/api/v1/reports', { authorization: 'Bearer member.jwt', [COMPANY_ID_HEADER]: COMPANY_ID })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reports: REPORT_CATALOGUE.map((report) => ({ ...report })) })
  })

  it('requires a verified access token', async () => {
    expect((await get('/api/v1/reports', { [COMPANY_ID_HEADER]: COMPANY_ID })).status).toBe(401)
    expect((await get('/api/v1/reports', { authorization: 'Bearer forged', [COMPANY_ID_HEADER]: COMPANY_ID })).status).toBe(401)
  })

  it('requires the active company header and membership of that company', async () => {
    expect((await get('/api/v1/reports', { authorization: 'Bearer member.jwt' })).status).toBe(400)
    expect((await get('/api/v1/reports', { authorization: 'Bearer member.jwt', [COMPANY_ID_HEADER]: OTHER_COMPANY_ID })).status).toBe(403)
    expect((await get('/api/v1/reports', { authorization: 'Bearer outsider.jwt', [COMPANY_ID_HEADER]: COMPANY_ID })).status).toBe(403)
  })

  it('serves its routes only under /api/v1 and documents them in its OpenAPI document', async () => {
    expect((await get('/reports', { authorization: 'Bearer member.jwt', [COMPANY_ID_HEADER]: COMPANY_ID })).status).toBe(404)
    const document = (await (await get('/api/docs-json')).json()) as { paths: Record<string, unknown>; info: { title: string } }
    expect(document.info.title).toBe('LeaseGuard Reports API')
    // The catalogue, health and one path per report built so far, each on the shared pattern /api/v1/reports/{reportId}.
    const paths = Object.keys(document.paths)
    expect(paths).toEqual(expect.arrayContaining(['/api/v1/reports', '/health', '/health/ready']))
    const reportPaths = paths.filter((path) => path.startsWith('/api/v1/reports/'))
    expect(paths).toHaveLength(reportPaths.length + 3)
    expect(reportPaths.map((path) => path.slice('/api/v1/reports/'.length)).filter((id) => !(REPORT_IDS as readonly string[]).includes(id))).toEqual([])
    expect(reportPaths).toEqual(
      expect.arrayContaining(['/api/v1/reports/portfolio_overview', '/api/v1/reports/occupancy', '/api/v1/reports/arrears', '/api/v1/reports/payment_arrangements']),
    )
  })

  const member = { authorization: 'Bearer member.jwt', [COMPANY_ID_HEADER]: COMPANY_ID }

  it('serves the portfolio overview from the reporting functions, with the caller\'s token and the active company', async () => {
    rpcCalls.length = 0
    const response = await get('/api/v1/reports/portfolio_overview', member)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      reportId: 'portfolio_overview',
      filters: {},
      data: {
        propertyCount: 1,
        unitCount: 2,
        occupiedUnits: 1,
        vacantUnits: 1,
        occupancyRate: 0.5,
        activeLeases: 1,
        monthlyRentalRoll: 12960,
        totalOutstanding: 4500.5,
        tenantsInArrears: 1,
        openEvents: 3,
        properties: [{ propertyId: PROPERTY_ID, code: 'MSQ', status: 'active', outstanding: 4500.5 }],
      },
    })
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rpcCalls.map((call) => call.fn).sort()).toEqual(['reports_arrears_accounts', 'reports_property_figures'])
    expect(rpcCalls.every((call) => call.accessToken === 'member.jwt' && call.args.p_company_id === COMPANY_ID)).toBe(true)
  })

  it('serves occupancy with each unit\'s current tenant, narrowed by repeated status and property filters', async () => {
    const all = (await (await get('/api/v1/reports/occupancy', member)).json()) as { data: { totals: { total: number }; units: unknown[] } }
    expect(all.data.totals.total).toBe(2)
    expect(all.data.units[0]).toMatchObject({ unitNumber: 'S01', tenantName: 'Dlamini Cellular', tenantSource: 'assignment' })

    const response = await get(`/api/v1/reports/occupancy?status=vacant&status=under_offer&propertyId=${PROPERTY_ID}`, member)
    expect(response.status).toBe(200)
    const filtered = (await response.json()) as { filters: unknown; data: { units: { unitNumber: string }[] } }
    expect(filtered.filters).toEqual({ propertyIds: [PROPERTY_ID], statuses: ['vacant', 'under_offer'] })
    expect(filtered.data.units.map((unit) => unit.unitNumber)).toEqual(['S02'])
  })

  it('refuses filters it cannot apply with 400, and an unknown report with 404', async () => {
    const wrongStatus = await get('/api/v1/reports/occupancy?status=archived', member)
    expect(wrongStatus.status).toBe(400)
    expect(JSON.stringify(await wrongStatus.json())).toContain('not offered by this report')
    expect((await get('/api/v1/reports/occupancy?propertyId=not-a-uuid', member)).status).toBe(400)
    expect((await get('/api/v1/reports/occupancy?sort=name', member)).status).toBe(400)
    expect((await get('/api/v1/reports/owner_summary', member)).status).toBe(404)
  })

  it('applies the same login and company checks to every report', async () => {
    for (const path of ['/api/v1/reports/portfolio_overview', '/api/v1/reports/occupancy']) {
      expect((await get(path, { [COMPANY_ID_HEADER]: COMPANY_ID })).status, path).toBe(401)
      expect((await get(path, { authorization: 'Bearer member.jwt' })).status, path).toBe(400)
      expect((await get(path, { authorization: 'Bearer outsider.jwt', [COMPANY_ID_HEADER]: COMPANY_ID })).status, path).toBe(403)
    }
  })
  it('serves arrears and payment arrangements on the same pattern, with the same checks (R-05)', async () => {
    rpcCalls.length = 0
    const arrears = await get('/api/v1/reports/arrears?status=under_arrangement', member)
    expect(arrears.status).toBe(200)
    expect(await arrears.json()).toMatchObject({ reportId: 'arrears', filters: { statuses: ['under_arrangement'] }, data: { ageingBuckets: [30, 60, 90, 120], rows: [] } })
    expect(rpcCalls.map((call) => call.fn).sort()).toEqual(['reports_arrears_detail', 'reports_arrears_settings', 'reports_payment_arrangements'])

    const arrangements = await get('/api/v1/reports/payment_arrangements?status=active&from=2026-01-01', member)
    expect(arrangements.status).toBe(200)
    expect(await arrangements.json()).toMatchObject({ reportId: 'payment_arrangements', filters: { from: '2026-01-01', statuses: ['active'] }, data: { graceDays: 0, rows: [] } })

    expect((await get('/api/v1/reports/arrears?status=active', member)).status).toBe(400)
    expect((await get('/api/v1/reports/payment_arrangements?from=2026-12-31&to=2026-01-01', member)).status).toBe(400)
    for (const path of ['/api/v1/reports/arrears', '/api/v1/reports/payment_arrangements']) {
      expect((await get(path, { [COMPANY_ID_HEADER]: COMPANY_ID })).status, path).toBe(401)
      expect((await get(path, { authorization: 'Bearer outsider.jwt', [COMPANY_ID_HEADER]: COMPANY_ID })).status, path).toBe(403)
    }
  })
})
