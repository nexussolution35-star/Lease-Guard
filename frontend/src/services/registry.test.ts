import { beforeEach, describe, expect, it } from 'vitest'

import { DEMO_REFERENCE_DATE, LEASE_IDS } from '@/services/demo/seed'
import { useAppStore } from '@/store/appStore'

import * as barrel from '@/services'
import { services } from '@/services/registry'

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('service registry', () => {
  it('exposes every contract and only functions/definitions', () => {
    expect(Object.keys(services).sort()).toEqual(
      ['approvals', 'arrangements', 'audit', 'communications', 'leases', 'monitoring', 'notifications', 'properties', 'reports', 'statements', 'templates', 'tenants', 'units', 'whatsapp'].sort(),
    )
    for (const [name, service] of Object.entries(services)) {
      for (const [fn, impl] of Object.entries(service)) {
        if (name === 'reports' && fn === 'definitions') continue
        expect(typeof impl, `${name}.${fn}`).toBe('function')
      }
    }
  })

  it('binds to the same implementations exported by the barrel', () => {
    expect(services.leases.verify).toBe(barrel.verifyLease)
    expect(services.approvals.listPendingApprovals).toBe(barrel.listApprovalQueue)
    expect(services.reports.getDashboardMetrics).toBe(barrel.getDashboardMetrics)
  })

  it('calls through to the store', () => {
    expect(services.leases.getContext(LEASE_IDS.msqL001)?.lease.reference).toBe('MSQ-L001')
    expect(services.reports.getDashboardMetrics(DEMO_REFERENCE_DATE).totalProperties).toBeGreaterThan(0)
  })

  it('does not export the search or workspace modules from the barrel', () => {
    expect('searchWorkspace' in barrel).toBe(false)
    expect('switchWorkspace' in barrel).toBe(false)
  })
})
