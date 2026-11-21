import { unwrap } from '@leaseguard/api-client'
import { leaseStatusAfterVerification } from '@leaseguard/domain'
import { beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, serviceRole, world } from './support/clients.ts'
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

describe('lease list (GET /leases): tenant search, names and the expiring window', () => {
  interface ListRow {
    id: string
    tenant_id: string
    expiry_date: string
  }

  /** The South African calendar date, as the API judges "today". */
  const saToday = (): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

  async function companyALeases(): Promise<ListRow[]> {
    return check(
      await serviceRole()
        .from('leases')
        .select('id, tenant_id, expiry_date')
        .eq('company_id', world().companies.a.id)
        .overrideTypes<ListRow[], { merge: false }>(),
      'List company A leases',
    )
  }

  it('finds leases by tenant trading or legal name, and names the tenant, property and unit of each row', async () => {
    const tenant = world().companies.a.tenants[0]!
    const expected = (await companyALeases()).filter((row) => row.tenant_id === tenant.id)
    if (expected.length === 0) throw new Error('The world has no lease for the first tenant of company A')
    const api = apiAs('readOnly', 'a')

    const byTrading = await unwrap(api.GET('/api/v1/leases', { params: { query: { search: tenant.tradingName.toUpperCase(), pageSize: 100 } } }))
    expect(byTrading.items.map((lease) => lease.id).sort()).toEqual(expected.map((row) => row.id).sort())
    for (const lease of byTrading.items) {
      expect(lease.tenantName).toBe(tenant.tradingName)
      const unit = world().companies.a.units.find((u) => u.id === lease.unitId)
      expect(lease.unitNumber).toBe(unit?.unitNumber)
      expect(lease.propertyName).not.toBe('')
    }

    const byLegal = await unwrap(api.GET('/api/v1/leases', { params: { query: { search: '(pty) ltd', pageSize: 100 } } }))
    expect(byLegal.total).toBe((await companyALeases()).length)
  })

  it('never matches a tenant of another company', async () => {
    const otherTenant = world().companies.b.tenants[0]!
    const page = await unwrap(apiAs('manager', 'a').GET('/api/v1/leases', { params: { query: { search: otherTenant.tradingName } } }))
    expect(page.total).toBe(0)
  })

  it('filters leases expiring from today to the given number of days, inclusive', async () => {
    const today = saToday()
    const rows = await companyALeases()
    const sorted = rows.map((row) => row.expiry_date).sort()
    // A window that ends exactly on the third-earliest expiry date, so the inclusive end is exercised.
    const end = sorted[2]!
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    if (days < 0 || days > 3650) throw new Error(`The world's lease expiries are outside the ten-year window (${days} days)`)
    const expected = rows.filter((row) => row.expiry_date >= today && row.expiry_date <= end)

    const page = await unwrap(apiAs('manager', 'a').GET('/api/v1/leases', { params: { query: { expiresWithinDays: days, pageSize: 100 } } }))
    expect(page.items.map((lease) => lease.id).sort()).toEqual(expected.map((row) => row.id).sort())
    expect(page.total).toBeGreaterThanOrEqual(1)

    const none = await unwrap(apiAs('manager', 'a').GET('/api/v1/leases', { params: { query: { expiresWithinDays: 0 } } }))
    expect(none.total).toBe(rows.filter((row) => row.expiry_date === today).length)
  })
})

describe('lease documents (GET /leases/{id}/documents)', () => {
  it('lists the documents recorded on the lease, with type and uploader, to any member; never across companies', async () => {
    const target = world().companies.a.leases[0]
    if (!target) throw new Error('The world has no lease in company A')
    const companyId = world().companies.a.id
    const documentId = crypto.randomUUID()
    const uploader = world().users.manager.id
    check(
      await serviceRole()
        .from('lease_documents')
        .insert({
          id: documentId,
          company_id: companyId,
          lease_id: target.id,
          document_type: 'signed_lease',
          title: 'Signed lease',
          file_name: 'signed.pdf',
          storage_path: `${companyId}/${documentId}/signed.pdf`,
          mime_type: 'application/pdf',
          size_bytes: 1024,
          sha256: 'b'.repeat(64),
          uploaded_by_user_id: uploader,
        })
        .select('id'),
      'Insert a lease document',
    )

    const documents = await unwrap(
      apiAs('readOnly', 'a').GET('/api/v1/leases/{leaseId}/documents', { params: { path: { leaseId: target.id } } }),
    )
    expect(documents).toEqual([
      expect.objectContaining({
        id: documentId,
        leaseId: target.id,
        documentType: 'signed_lease',
        uploadedByUserId: uploader,
        file: expect.objectContaining({ fileName: 'signed.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }),
      }),
    ])

    const error = await apiErrorOf(
      unwrap(apiAs('manager', 'b').GET('/api/v1/leases/{leaseId}/documents', { params: { path: { leaseId: target.id } } })),
    )
    expect(error.status).toBe(404)
  })
})
