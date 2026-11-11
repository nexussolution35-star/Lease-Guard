import { ConflictException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import type { PropertyRow } from './properties.mapper'
import { createPropertyBodySchema, propertyListQuerySchema, updatePropertyBodySchema } from './properties.schemas'
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

  describe('writes', () => {
    const MANAGER = '6f1d2c1e-0000-4000-8000-0000000000bb'
    const body = createPropertyBodySchema.parse({
      name: '  Rosebank Corner ',
      code: 'rbc',
      type: 'office',
      address: { line1: '1 Cradock Avenue', line2: '', suburb: 'Rosebank', city: 'Johannesburg', province: 'Gauteng', postalCode: '2196' },
      grossLettableAreaSqm: 4200.5,
      managerUserId: MANAGER,
      accountingSystem: 'Sage',
    })

    it('normalises the create body: trimmed text, upper-case code, cleared address line', () => {
      expect(body).toMatchObject({ name: 'Rosebank Corner', code: 'RBC', address: { line2: null } })
      expect(createPropertyBodySchema.safeParse({ ...body, code: 'TOO-LONG-CODE' }).success).toBe(false)
      expect(createPropertyBodySchema.safeParse({ ...body, grossLettableAreaSqm: 0 }).success).toBe(false)
      expect(createPropertyBodySchema.safeParse({ ...body, grossLettableAreaSqm: 10.123 }).success).toBe(false)
      for (const area of [4200.35, 1.13, 2.01, 1250.1, 0.07]) expect(createPropertyBodySchema.safeParse({ ...body, grossLettableAreaSqm: area }).success).toBe(true)
      expect(createPropertyBodySchema.safeParse({ ...body, status: 'archived' }).success).toBe(false)
      expect(createPropertyBodySchema.safeParse({ ...body, companyId: COMPANY }).success).toBe(false)
    })

    it('refuses an empty edit, a code change and archiving through an edit', () => {
      expect(updatePropertyBodySchema.safeParse({}).success).toBe(false)
      expect(updatePropertyBodySchema.safeParse({ code: 'NEW' }).success).toBe(false)
      expect(updatePropertyBodySchema.safeParse({ status: 'archived' }).success).toBe(false)
      expect(updatePropertyBodySchema.parse({ ownerUserId: null })).toEqual({ ownerUserId: null })
    })

    it('creates a property in the active company with defaults for status, description and owner', async () => {
      const { client, queries } = fakeDb(() => ({ data: { ...row, name: 'Rosebank Corner', code: 'RBC' }, error: null }))
      const property = await service.create(client, COMPANY, body)
      expect(property).toMatchObject({ name: 'Rosebank Corner', code: 'RBC' })
      expect(callsTo(queries[0]!, 'insert')).toEqual([
        [
          {
            company_id: COMPANY,
            name: 'Rosebank Corner',
            code: 'RBC',
            type: 'office',
            status: 'active',
            address_line1: '1 Cradock Avenue',
            address_line2: null,
            suburb: 'Rosebank',
            city: 'Johannesburg',
            province: 'Gauteng',
            postal_code: '2196',
            description: '',
            gross_lettable_area_sqm: 4200.5,
            manager_user_id: MANAGER,
            owner_user_id: null,
            accounting_system: 'Sage',
          },
        ],
      ])
    })

    it('explains a duplicate code, a non-member and a manager who does not qualify', async () => {
      const failWith = (code: string, message = 'database message') =>
        service.create(fakeDb(() => ({ data: null, error: { code, message } })).client, COMPANY, body)
      await expect(failWith('23505')).rejects.toThrow(new ConflictException('A property with the code RBC already exists in this workspace'))
      await expect(failWith('23503')).rejects.toThrow(UnprocessableEntityException)
      await expect(failWith('23503')).rejects.toThrow('The property manager and owner must be members of this workspace')
      await expect(failWith('P0001', 'The property manager must be a company admin or property manager of this workspace')).rejects.toThrow(
        'The property manager must be a company admin or property manager of this workspace',
      )
    })

    it('edits only the fields sent, replacing the whole address, in the active company', async () => {
      const { client, queries } = fakeDb(() => ({ data: row, error: null }))
      await service.update(
        client,
        COMPANY,
        row.id,
        updatePropertyBodySchema.parse({
          name: 'Mall Square North',
          ownerUserId: null,
          address: { line1: '2 Main Road', suburb: 'Hatfield', city: 'Pretoria', province: 'Gauteng', postalCode: '0083' },
        }),
      )
      expect(callsTo(queries[0]!, 'update')).toEqual([
        [{ name: 'Mall Square North', address_line1: '2 Main Road', address_line2: null, suburb: 'Hatfield', city: 'Pretoria', province: 'Gauteng', postal_code: '0083', owner_user_id: null }],
      ])
      expect(callsTo(queries[0]!, 'eq')).toEqual([
        ['company_id', COMPANY],
        ['id', row.id],
      ])
    })

    it('answers 404 for a property that is not in the company', async () => {
      const { client } = fakeDb(() => ({ data: null, error: null }))
      await expect(service.update(client, COMPANY, row.id, { name: 'X' })).rejects.toThrow(NotFoundException)
    })

    it('says an archived property must be restored before an edit', async () => {
      const { client } = fakeDb(() => ({ data: null, error: { code: 'P0001', message: 'This property is archived. Restore it before changing it.' } }))
      await expect(service.update(client, COMPANY, row.id, { name: 'X' })).rejects.toThrow(
        new UnprocessableEntityException('This property is archived. Restore it before changing it.'),
      )
    })

    it('archives an active property and returns an archived one unchanged', async () => {
      const archived = { ...row, status: 'archived' as const }
      const first = fakeDb((query) => ({ data: callsTo(query, 'update').length ? archived : row, error: null }))
      expect((await service.archive(first.client, COMPANY, row.id)).status).toBe('archived')
      expect(callsTo(first.queries[1]!, 'update')).toEqual([[{ status: 'archived' }]])

      const again = fakeDb(() => ({ data: archived, error: null }))
      expect((await service.archive(again.client, COMPANY, row.id)).status).toBe('archived')
      expect(again.queries).toHaveLength(1)
    })

    it('answers 409 when the property still has leases that have not ended', async () => {
      const message = 'This property still has leases that have not ended. End or terminate them before archiving the property.'
      const { client } = fakeDb((query) => (callsTo(query, 'update').length ? { data: null, error: { code: 'P0001', message } } : { data: row, error: null }))
      await expect(service.archive(client, COMPANY, row.id)).rejects.toThrow(new ConflictException(message))
    })

    it('restores an archived property to active and leaves an active one alone', async () => {
      const archived = { ...row, status: 'archived' as const }
      const restore = fakeDb((query) => ({ data: callsTo(query, 'update').length ? row : archived, error: null }))
      expect((await service.restore(restore.client, COMPANY, row.id)).status).toBe('active')
      expect(callsTo(restore.queries[1]!, 'update')).toEqual([[{ status: 'active' }]])

      const active = fakeDb(() => ({ data: row, error: null }))
      await service.restore(active.client, COMPANY, row.id)
      expect(active.queries).toHaveLength(1)
    })
  })
})
