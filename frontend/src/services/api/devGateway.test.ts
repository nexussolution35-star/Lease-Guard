import routesJson from '../../../../infrastructure/gateway/routes.json?raw'
import { describe, expect, it } from 'vitest'

import { devGatewayProxy, parseGatewayRoutes, serviceForPath } from './devGateway'

const routes = parseGatewayRoutes(JSON.parse(routesJson))
const TARGETS = { core: 'http://127.0.0.1:3000', reports: 'http://127.0.0.1:3100' }

describe('development gateway', () => {
  it('routes /api/v1/reports and everything below it to the reports service, every other path to the core', () => {
    expect(serviceForPath(routes, '/api/v1/reports')).toBe('reports')
    expect(serviceForPath(routes, '/api/v1/reports/portfolio_overview?propertyId=1')).toBe('reports')
    expect(serviceForPath(routes, '/api/v1/reports?x=1')).toBe('reports')
    expect(serviceForPath(routes, '/api/v1/reportsx')).toBe('core')
    expect(serviceForPath(routes, '/api/v1/dashboard/summary')).toBe('core')
    expect(serviceForPath(routes, '/health/ready')).toBe('core')
  })

  it('builds Vite proxy rules with the service routes before the core catch-all', () => {
    const proxy = devGatewayProxy(routes, TARGETS)
    const keys = Object.keys(proxy)
    expect(keys[0]).toBe('^/api/v1/reports(?:[/?]|$)')
    expect(proxy[keys[0]!]).toEqual({ target: TARGETS.reports, changeOrigin: false, xfwd: true })
    expect(keys.slice(-2)).toEqual(['^/api(?:[/?]|$)', '^/health(?:[/?]|$)'])
    expect(proxy['^/api(?:[/?]|$)']?.target).toBe(TARGETS.core)
    // The first matching key wins, as in Vite's proxy middleware.
    const first = (path: string) => keys.find((key) => new RegExp(key).test(path))
    expect(proxy[first('/api/v1/reports')!]?.target).toBe(TARGETS.reports)
    expect(proxy[first('/api/v1/properties')!]?.target).toBe(TARGETS.core)
    expect(first('/reports')).toBeUndefined()
  })

  it('refuses a table naming a service without a development address, or a malformed table', () => {
    expect(() => devGatewayProxy(routes, { core: TARGETS.core })).toThrow(/"reports" service/)
    expect(() => parseGatewayRoutes({ routes: [] })).toThrow(/routes\.json is invalid/)
  })
})
