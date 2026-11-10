import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { unitListQuerySchema } from './units.schemas'
import { UnitsService } from './units.service'
import { COMPANY, unitRow } from './units.test-helpers'

describe('UnitsService', () => {
  const service = new UnitsService()

  it('lists one company with filters, search, sorting and paging', async () => {
    const { client, queries } = fakeDb(() => ({ data: [unitRow], error: null, count: 3 }))
    const query = unitListQuerySchema.parse({
      propertyId: unitRow.property_id,
      occupancyStatus: 'occupied',
      type: 'line_shop',
      search: 'G1',
      sort: 'floorAreaSqm',
      direction: 'desc',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25, items: [{ id: unitRow.id, unitNumber: 'G12' }] })
    const [q] = queries
    expect(q?.table).toBe('units')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['property_id', unitRow.property_id],
      ['occupancy_status', 'occupied'],
      ['type', 'line_shop'],
    ])
    expect(callsTo(q!, 'or')).toEqual([['unit_number.ilike."%G1%"']])
    expect(callsTo(q!, 'order')[0]).toEqual(['floor_area_sqm', { ascending: false }])
    expect(callsTo(q!, 'range')).toEqual([[0, 24]])
  })

  it('rejects a malformed propertyId filter', () => {
    expect(unitListQuerySchema.safeParse({ propertyId: 'not-a-uuid' }).success).toBe(false)
  })

  it('gets one unit of the company', async () => {
    const { client, queries } = fakeDb(() => ({ data: unitRow, error: null }))
    await expect(service.get(client, COMPANY, unitRow.id)).resolves.toMatchObject({ id: unitRow.id })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', unitRow.id],
    ])
  })

  it('returns 404 when the unit is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, unitRow.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, unitListQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
