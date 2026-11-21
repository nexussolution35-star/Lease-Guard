import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { tenantListQuerySchema } from './tenants.schemas'
import { TenantsService } from './tenants.service'
import { TENANT_CURRENT_UNIT_COLUMNS, TENANT_LEASE_COLUMNS } from './tenants.mapper'
import { COMPANY, PROPERTY, tenantListRow, tenantRow } from './tenants.test-helpers'

describe('TenantsService', () => {
  const service = new TenantsService()

  it('lists one company with filters, name search, sorting and paging', async () => {
    const { client, queries } = fakeDb(() => ({ data: [tenantRow], error: null, count: 40 }))
    const query = tenantListQuerySchema.parse({
      status: 'in_arrears',
      businessType: 'pty_ltd',
      search: 'ubuntu',
      page: '3',
      pageSize: '10',
      sort: 'legalName',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({ total: 40, page: 3, pageSize: 10, items: [{ id: tenantRow.id }] })
    const [q] = queries
    expect(q?.table).toBe('tenants')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'in_arrears'],
      ['business_type', 'pty_ltd'],
    ])
    expect(callsTo(q!, 'or')).toEqual([
      ['legal_name.ilike."%ubuntu%",trading_name.ilike."%ubuntu%",contact_full_name.ilike."%ubuntu%"'],
    ])
    expect(callsTo(q!, 'order')[0]).toEqual(['legal_name', { ascending: true }])
    expect(callsTo(q!, 'range')).toEqual([[20, 29]])
  })

  it('embeds each tenant\'s leases and current units with their unit and property, and maps the current lease', async () => {
    const { client, queries } = fakeDb(() => ({ data: [tenantListRow], error: null, count: 1 }))
    const page = await service.list(client, COMPANY, tenantListQuerySchema.parse({}))

    expect(callsTo(queries[0]!, 'select')[0]?.[0]).toBe(
      `*, leases!leases_tenant_fk(${TENANT_LEASE_COLUMNS}), current_units:units!units_current_tenant_fk(${TENANT_CURRENT_UNIT_COLUMNS})`,
    )
    expect(page.items[0]).toMatchObject({ leaseCount: 2, currentLease: { reference: 'ACP-001', unitNumber: '001', propertyName: 'Acacia Park' } })
  })

  it('filters by property through an inner join on the tenant\'s leases', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, tenantListQuerySchema.parse({ propertyId: PROPERTY }))

    const [q] = queries
    expect(callsTo(q!, 'select')[0]?.[0]).toBe(
      `*, leases!leases_tenant_fk!inner(${TENANT_LEASE_COLUMNS}), current_units:units!units_current_tenant_fk(${TENANT_CURRENT_UNIT_COLUMNS})`,
    )
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['leases.property_id', PROPERTY],
    ])
  })

  it('rejects a property filter that is not a UUID', () => {
    expect(tenantListQuerySchema.safeParse({ propertyId: 'ACP' }).success).toBe(false)
  })

  it('defaults to sorting by trading name', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, tenantListQuerySchema.parse({}))
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['trading_name', { ascending: true }])
  })

  it('gets one tenant of the company', async () => {
    const { client, queries } = fakeDb(() => ({ data: tenantRow, error: null }))
    await expect(service.get(client, COMPANY, tenantRow.id)).resolves.toMatchObject({ tradingName: 'Ubuntu Coffee' })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', tenantRow.id],
    ])
  })

  it('returns 404 when the tenant is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, tenantRow.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, tenantListQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
