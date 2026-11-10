import { unwrap } from '@leaseguard/api-client'
import { leaseStatusAfterVerification } from '@leaseguard/domain'
import { beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, world } from './support/clients.ts'
import { auditCount, snapshotRow, type RowSnapshot } from './support/local-db.ts'

/** The world's lease awaiting verification in company A (deleted with the world at teardown). */
let lease: WorldLease
let original: RowSnapshot
let auditBefore = 0

beforeAll(async () => {
  const candidate = world().companies.a.leases.find((l) => l.status === 'pending_verification')
  if (!candidate) throw new Error('The world has no pending_verification lease in company A')
  lease = candidate
  original = await snapshotRow('leases', lease.id)
  auditBefore = await auditCount(lease.id)
})

describe('lease verification (POST /leases/{id}/verify)', () => {
  it('refuses a read_only member (403) and changes nothing', async () => {
    const error = await apiErrorOf(
      unwrap(apiAs('readOnly', 'a').POST('/api/v1/leases/{leaseId}/verify', { params: { path: { leaseId: lease.id } } })),
    )
    expect(error.status).toBe(403)
    expect(await snapshotRow('leases', lease.id)).toEqual(original)
  })

  it('lets a property manager verify the terms; the database stamps who and when', async () => {
    const managerId = world().users.manager.id
    const api = apiAs('manager', 'a')
    const verified = await unwrap(api.POST('/api/v1/leases/{leaseId}/verify', { params: { path: { leaseId: lease.id } } }))
    expect(verified.id).toBe(lease.id)
    expect(verified.verified).toBe(true)
    expect(verified.status).toBe(leaseStatusAfterVerification(lease.status))
    expect(verified.status).toBe('active')
    expect(verified.verifiedByUserId).toBe(managerId)
    expect(verified.verifiedAt).toBeTruthy()

    const reread = await unwrap(api.GET('/api/v1/leases/{leaseId}', { params: { path: { leaseId: lease.id } } }))
    expect(reread).toMatchObject({ verified: true, status: 'active', verifiedByUserId: managerId })
    expect(await auditCount(lease.id)).toBe(auditBefore + 1)
  })

  it('is idempotent: verifying again keeps the original verifier and time', async () => {
    const first = await unwrap(apiAs('manager', 'a').GET('/api/v1/leases/{leaseId}', { params: { path: { leaseId: lease.id } } }))
    const again = await unwrap(apiAs('admin', 'a').POST('/api/v1/leases/{leaseId}/verify', { params: { path: { leaseId: lease.id } } }))
    expect(again.verifiedByUserId).toBe(world().users.manager.id)
    expect(again.verifiedAt).toBe(first.verifiedAt)
  })
})
