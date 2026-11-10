import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { leaseListQuerySchema } from './leases.schemas'
import { LeasesService } from './leases.service'
import { COMPANY, guaranteeRow, leaseRow, unverifiedLeaseRow, VERIFIER } from './leases.test-helpers'

const isUpdate = (query: RecordedQuery): boolean => callsTo(query, 'update').length > 0
const LEASE_ID = leaseRow.id

describe('LeasesService', () => {
  const service = new LeasesService()

  it('lists one company with every filter, reference search, sorting and paging', async () => {
    const { client, queries } = fakeDb(() => ({
      data: [{ ...leaseRow, lease_bank_guarantees: [guaranteeRow] }],
      error: null,
      count: 1,
    }))
    const query = leaseListQuerySchema.parse({
      status: 'active',
      propertyId: leaseRow.property_id,
      unitId: leaseRow.unit_id,
      tenantId: leaseRow.tenant_id,
      verified: 'false',
      search: 'MSQ',
      sort: 'expiryDate',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page.items[0]).toMatchObject({ id: LEASE_ID, bankGuarantee: { bank: 'Standard Bank' } })
    const [q] = queries
    expect(q?.table).toBe('leases')
    expect(callsTo(q!, 'select')).toEqual([['*, lease_bank_guarantees(*)', { count: 'exact' }]])
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'active'],
      ['property_id', leaseRow.property_id],
      ['unit_id', leaseRow.unit_id],
      ['tenant_id', leaseRow.tenant_id],
      ['verified', false],
    ])
    expect(callsTo(q!, 'or')).toEqual([['reference.ilike."%MSQ%"']])
    expect(callsTo(q!, 'order')[0]).toEqual(['expiry_date', { ascending: true }])
  })

  it('accepts only true/false for the verified filter', () => {
    expect(leaseListQuerySchema.parse({ verified: 'true' }).verified).toBe(true)
    expect(leaseListQuerySchema.parse({}).verified).toBeUndefined()
    expect(leaseListQuerySchema.safeParse({ verified: 'yes' }).success).toBe(false)
  })

  it('gets one lease of the company with its guarantee', async () => {
    const { client, queries } = fakeDb(() => ({ data: { ...leaseRow, lease_bank_guarantees: [guaranteeRow] }, error: null }))
    const lease = await service.get(client, COMPANY, LEASE_ID)

    expect(lease.bankGuarantee?.expiresOn).toBe('2027-02-14')
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', LEASE_ID],
    ])
  })

  it('returns 404 when the lease is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, LEASE_ID)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, leaseListQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  describe('verify', () => {
    it('writes verified = true and the domain status (pending → active), conditionally, and leaves stamping to the database trigger', async () => {
      const { client, queries } = fakeDb((query) =>
        isUpdate(query)
          ? { data: { ...leaseRow, lease_bank_guarantees: [] }, error: null }
          : { data: { ...unverifiedLeaseRow, lease_bank_guarantees: [] }, error: null },
      )

      const lease = await service.verify(client, COMPANY, LEASE_ID)

      expect(lease).toMatchObject({ verified: true, verifiedByUserId: VERIFIER })
      const update = queries.find(isUpdate)
      expect(callsTo(update!, 'update')).toEqual([[{ verified: true, status: 'active' }]])
      expect(callsTo(update!, 'eq')).toEqual([
        ['company_id', COMPANY],
        ['id', LEASE_ID],
        ['verified', false],
      ])
      expect(callsTo(update!, 'select')).toEqual([['*, lease_bank_guarantees(*)']])
    })

    it('returns an already verified lease unchanged without writing', async () => {
      const { client, queries } = fakeDb(() => ({ data: { ...leaseRow, lease_bank_guarantees: [] }, error: null }))

      const lease = await service.verify(client, COMPANY, LEASE_ID)

      expect(lease.verifiedAt).toBe(leaseRow.verified_at)
      expect(queries.some(isUpdate)).toBe(false)
    })

    it('returns 404 for a lease that is not visible', async () => {
      const { client, queries } = fakeDb(() => ({ data: null, error: null }))
      await expect(service.verify(client, COMPANY, LEASE_ID)).rejects.toBeInstanceOf(NotFoundException)
      expect(queries.some(isUpdate)).toBe(false)
    })

    it('returns the lease verified by a concurrent request when the conditional update matched nothing', async () => {
      let reads = 0
      const { client } = fakeDb((query) => {
        if (isUpdate(query)) return { data: null, error: null }
        reads += 1
        const row = reads === 1 ? unverifiedLeaseRow : leaseRow
        return { data: { ...row, lease_bank_guarantees: [] }, error: null }
      })

      await expect(service.verify(client, COMPANY, LEASE_ID)).resolves.toMatchObject({ verified: true })
    })

    it('refuses with 403 when Row Level Security blocked the update', async () => {
      const { client } = fakeDb((query) =>
        isUpdate(query) ? { data: null, error: null } : { data: { ...unverifiedLeaseRow, lease_bank_guarantees: [] }, error: null },
      )
      await expect(service.verify(client, COMPANY, LEASE_ID)).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('surfaces a database rule violation as 422', async () => {
      const { client } = fakeDb((query) =>
        isUpdate(query)
          ? { data: null, error: { code: '23514', message: 'leases_verification_check' } }
          : { data: { ...unverifiedLeaseRow, lease_bank_guarantees: [] }, error: null },
      )
      await expect(service.verify(client, COMPANY, LEASE_ID)).rejects.toMatchObject({ status: 422 })
    })
  })
})
