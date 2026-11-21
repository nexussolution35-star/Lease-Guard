import { ConflictException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { createUnitBodySchema, unitListQuerySchema, updateUnitBodySchema } from './units.schemas'
import { UNIT_LIST_SELECT, UnitsService } from './units.service'
import { COMPANY, unitListRow, unitRow } from './units.test-helpers'

describe('UnitsService', () => {
  const service = new UnitsService()

  it('lists one company with filters, search, sorting and paging', async () => {
    const { client, queries } = fakeDb(() => ({ data: [unitListRow], error: null, count: 3 }))
    const query = unitListQuerySchema.parse({
      propertyId: unitRow.property_id,
      occupancyStatus: 'occupied',
      type: 'line_shop',
      search: 'G1',
      sort: 'floorAreaSqm',
      direction: 'desc',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 25,
      items: [{ id: unitRow.id, unitNumber: 'G12', property: { name: 'Maponya Square' }, currentTenant: { tradingName: 'Thrifty Foods' } }],
    })
    const [q] = queries
    expect(q?.table).toBe('units')
    expect(callsTo(q!, 'select')).toEqual([[UNIT_LIST_SELECT, { count: 'exact' }]])
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

  describe('writes', () => {
    const body = createUnitBodySchema.parse({
      propertyId: unitRow.property_id,
      unitNumber: '  G14 ',
      type: 'kiosk',
      floorAreaSqm: 12.5,
      floor: '',
    })

    it('normalises the create body and refuses derived or unknown fields', () => {
      expect(body).toEqual({ propertyId: unitRow.property_id, unitNumber: 'G14', type: 'kiosk', floorAreaSqm: 12.5, floor: null })
      expect(createUnitBodySchema.safeParse({ ...body, unitNumber: '   ' }).success).toBe(false)
      expect(createUnitBodySchema.safeParse({ ...body, floorAreaSqm: 0 }).success).toBe(false)
      expect(createUnitBodySchema.safeParse({ ...body, floorAreaSqm: 10.123 }).success).toBe(false)
      for (const area of [4200.35, 1.13, 2.01, 0.07]) expect(createUnitBodySchema.safeParse({ ...body, floorAreaSqm: area }).success).toBe(true)
      expect(createUnitBodySchema.safeParse({ ...body, propertyId: 'not-a-uuid' }).success).toBe(false)
      expect(createUnitBodySchema.safeParse({ ...body, occupancyStatus: 'let' }).success).toBe(false)
      for (const derived of ['currentTenantId', 'currentLeaseId', 'companyId']) {
        expect(createUnitBodySchema.safeParse({ ...body, [derived]: unitRow.current_tenant_id }).success).toBe(false)
      }
    })

    it('refuses an empty edit and a property move', () => {
      expect(updateUnitBodySchema.safeParse({}).success).toBe(false)
      expect(updateUnitBodySchema.safeParse({ propertyId: unitRow.property_id }).success).toBe(false)
      expect(updateUnitBodySchema.safeParse({ currentLeaseId: unitRow.current_lease_id }).success).toBe(false)
      expect(updateUnitBodySchema.parse({ floor: null, description: '' })).toEqual({ floor: null, description: null })
    })

    it('creates a vacant unit in the active company unless an occupancy status is sent', async () => {
      const { client, queries } = fakeDb(() => ({ data: { ...unitRow, unit_number: 'G14' }, error: null }))
      const unit = await service.create(client, COMPANY, body)
      expect(unit).toMatchObject({ unitNumber: 'G14' })
      expect(callsTo(queries[0]!, 'insert')).toEqual([
        [
          {
            company_id: COMPANY,
            property_id: unitRow.property_id,
            unit_number: 'G14',
            type: 'kiosk',
            floor_area_sqm: 12.5,
            floor: null,
            occupancy_status: 'vacant',
            description: null,
          },
        ],
      ])

      const underOffer = fakeDb(() => ({ data: unitRow, error: null }))
      await service.create(underOffer.client, COMPANY, { ...body, occupancyStatus: 'under_offer' })
      expect(callsTo(underOffer.queries[0]!, 'insert')[0]?.[0]).toMatchObject({ occupancy_status: 'under_offer' })
    })

    it('explains a duplicate unit number, a property outside the company and an archived property', async () => {
      const failWith = (code: string, message = 'database message') =>
        service.create(fakeDb(() => ({ data: null, error: { code, message } })).client, COMPANY, body)
      await expect(failWith('23505')).rejects.toThrow(new ConflictException('A unit numbered G14 already exists in this property'))
      await expect(failWith('23503')).rejects.toThrow(new UnprocessableEntityException('Choose a property in this workspace'))
      const archived = 'This property is archived. Restore it before adding or changing its units.'
      await expect(failWith('P0001', archived)).rejects.toThrow(new UnprocessableEntityException(archived))
    })

    it('edits only the fields sent, in the active company', async () => {
      const { client, queries } = fakeDb(() => ({ data: { ...unitRow, occupancy_status: 'vacant' }, error: null }))
      const unit = await service.update(client, COMPANY, unitRow.id, updateUnitBodySchema.parse({ occupancyStatus: 'vacant', floor: '' }))
      expect(unit.occupancyStatus).toBe('vacant')
      expect(callsTo(queries[0]!, 'update')).toEqual([[{ occupancy_status: 'vacant', floor: null }]])
      expect(callsTo(queries[0]!, 'eq')).toEqual([
        ['company_id', COMPANY],
        ['id', unitRow.id],
      ])
    })

    it('answers 404 for a unit outside the company, 409 for a taken number and 422 for a leased unit made vacant', async () => {
      await expect(service.update(fakeDb(() => ({ data: null, error: null })).client, COMPANY, unitRow.id, { type: 'kiosk' })).rejects.toThrow(
        NotFoundException,
      )
      const taken = fakeDb(() => ({ data: null, error: { code: '23505', message: 'duplicate' } }))
      await expect(service.update(taken.client, COMPANY, unitRow.id, { unitNumber: 'G11' })).rejects.toThrow(
        new ConflictException('A unit numbered G11 already exists in this property'),
      )
      const leased = 'This unit has a current lease, so it stays occupied until the lease ends.'
      const occupied = fakeDb(() => ({ data: null, error: { code: 'P0001', message: leased } }))
      await expect(service.update(occupied.client, COMPANY, unitRow.id, { occupancyStatus: 'vacant' })).rejects.toThrow(
        new UnprocessableEntityException(leased),
      )
    })
  })
})
