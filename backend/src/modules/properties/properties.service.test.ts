import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import type { PropertyRow } from './properties.mapper'
import { propertyListQuerySchema } from './properties.schemas'
import { PropertiesService } from './properties.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'

const row: PropertyRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000aa',
  company_id: COMPANY,
  name: 'Mall Square',
  code: 'MSQ',
  type: 'shopping_centre',
  address_line1: '1 Main Road',
  address_line2: null,
  suburb: 'Hatfield',
  city: 'Pretoria',
  province: 'Gauteng',
  postal_code: '0083',
  country: 'South Africa',
  description: '',
  status: 'active',
  gross_lettable_area_sqm: 12500.5,
  manager_user_id: '6f1d2c1e-0000-4000-8000-0000000000bb',
  owner_user_id: null,
  accounting_system: 'MRI',
  created_at: '2026-11-01T08:00:00+00:00',
  updated_at: '2026-11-01T08:00:00+00:00',
}

describe('PropertiesService', () => {
  const service = new PropertiesService()

  it('lists one company with filters, search, sorting and paging', async () => {
    const { client, queries } = fakeDb(() => ({ data: [row], error: null, count: 31 }))
    const query = propertyListQuerySchema.parse({ page: '2', pageSize: '10', search: 'mall', status: 'active', sort: 'code', direction: 'desc' })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({ total: 31, page: 2, pageSize: 10 })
    expect(page.items[0]).toMatchObject({ id: row.id, companyId: COMPANY, address: { line1: '1 Main Road', postalCode: '0083' } })
    expect(page.items[0]?.address).not.toHaveProperty('line2')
    expect(page.items[0]).not.toHaveProperty('ownerUserId')

    const [q] = queries
    expect(q?.table).toBe('properties')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'active'],
    ])
    expect(callsTo(q!, 'or')).toEqual([['name.ilike."%mall%",code.ilike."%mall%",city.ilike."%mall%",suburb.ilike."%mall%"']])
    expect(callsTo(q!, 'order')[0]).toEqual(['code', { ascending: false }])
    expect(callsTo(q!, 'range')).toEqual([[10, 19]])
  })

  it('answers a page past the last row with an empty page and the real total', async () => {
    const { client, queries } = fakeDb((query) => {
      const [from] = (callsTo(query, 'range')[0] ?? [0]) as [number]
      return from > 0
        ? { data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null }
        : { data: [row], error: null, count: 7 }
    })

    const page = await service.list(client, COMPANY, propertyListQuerySchema.parse({ page: '40', pageSize: '10', status: 'active' }))

    expect(page).toEqual({ items: [], total: 7, page: 40, pageSize: 10 })
    expect(queries).toHaveLength(2)
    // The count query repeats the same filters.
    expect(callsTo(queries[1]!, 'eq')).toEqual(callsTo(queries[0]!, 'eq'))
    expect(callsTo(queries[1]!, 'range')).toEqual([[0, 0]])
  })

  it('returns 404 when the property is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, row.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, propertyListQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
