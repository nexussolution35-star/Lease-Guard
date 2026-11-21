import { unwrap } from '@leaseguard/api-client'
import { afterAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Unit management (PRD module 3) through the real API and the local database: writers create and edit units; members
 * who only read are refused; another company's unit is not found; the database rules (unit number unique in its
 * property, property in the company, archived property read-only) answer in words; and every change, occupancy
 * status changes included, reaches the audit log.
 */

/** Unit numbers this file creates, unique per run (the world's unit numbers look like `ACP-001`). */
const number = (suffix: string) => `ZU${suffix}-${integration().runId}`.slice(0, 30)

/** The unit the first test creates; the later tests change it. */
let createdId: string | undefined
/** A property of company A without leases, archived by the archived-property test; removed afterwards with its units. */
let archivedPropertyId: string | undefined

afterAll(async () => {
  const a = world().companies.a.id
  if (createdId) expectOk(await serviceRole().from('units').delete().eq('company_id', a).eq('id', createdId), 'Delete this file’s unit')
  if (archivedPropertyId) {
    expectOk(await serviceRole().from('properties').delete().eq('company_id', a).eq('id', archivedPropertyId), 'Delete this file’s property')
  }
})

const property = () => world().companies.a.properties.find((p) => p.code === 'ACP')!

const newUnit = (unitNumber: string) => ({
  propertyId: property().id,
  unitNumber,
  type: 'kiosk' as const,
  floorAreaSqm: 12.5,
})

interface AuditRow {
  action: string
  summary: string
  changes: unknown
}

/** Every audit entry for one record, oldest first, read as the database owner (one query: each one starts the CLI). */
async function audits(entityId: string): Promise<AuditRow[]> {
  if (!/^[0-9a-f-]{36}$/.test(entityId)) throw new Error(`Not a uuid: ${entityId}`)
  return (await localSql(
    `select action::text, summary, changes from public.audit_logs where entity_id = '${entityId}' order by occurred_at, id`,
  )) as AuditRow[]
}

/** `supabase db query` starts a process per call and is slow while other suites share the machine. */
const SLOW = 90_000

describe('units: create', () => {
  it('lets a property manager create a vacant unit and records the audit entry', async () => {
    const unit = await unwrap(apiAs('manager', 'a').POST('/api/v1/units', { body: { ...newUnit(` ${number('A')} `), floor: '' } }))
    expect(unit).toMatchObject({
      companyId: world().companies.a.id,
      propertyId: property().id,
      unitNumber: number('A'),
      type: 'kiosk',
      floorAreaSqm: 12.5,
      occupancyStatus: 'vacant',
    })
    expect(unit).not.toHaveProperty('floor')
    expect(unit).not.toHaveProperty('currentTenantId')
    expect((await audits(unit.id)).map((entry) => entry.action)).toEqual(['create'])
    createdId = unit.id

    const fetched = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/units/{unitId}', { params: { path: { unitId: unit.id } } }))
    expect(fetched.unitNumber).toBe(number('A'))
  }, SLOW)

  it('refuses a unit number already used in the property (409) and a property of another company (422)', async () => {
    const taken = world().companies.a.units.find((u) => u.propertyId === property().id)!
    const duplicate = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/units', { body: newUnit(taken.unitNumber) })))
    expect(duplicate.status).toBe(409)
    expect(duplicate.messages.join(' ')).toBe(`A unit numbered ${taken.unitNumber} already exists in this property`)

    // The manager also manages company B: under B, A's property is not B's.
    const elsewhere = await apiErrorOf(unwrap(apiAs('manager', 'b').POST('/api/v1/units', { body: newUnit(number('B')) })))
    expect(elsewhere.status).toBe(422)
    expect(elsewhere.messages.join(' ')).toBe('Choose a property in this workspace')
  })

  it('validates the body (400), never takes a tenant or lease, and refuses members who only read (403)', async () => {
    const invalid = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/units', { body: { ...newUnit('  '), floorAreaSqm: 0 } })))
    expect(invalid.status).toBe(400)
    expect(invalid.messages.join(' ')).toMatch(/unitNumber: Enter the unit number/)

    const derived = { ...newUnit(number('C')), currentTenantId: world().companies.a.tenants[0]!.id }
    expect((await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/units', { body: derived as never })))).status).toBe(400)

    for (const user of ['readOnly', 'owner'] as const) {
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/units', { body: newUnit(number('C')) })))).status).toBe(403)
    }
  })
})

describe('units: edit', () => {
  const created = () => {
    if (!createdId) throw new Error('The create test did not run or failed')
    return createdId
  }

  it('edits only the fields sent and audits an occupancy status change as such', async () => {
    const unitId = created()
    const path = { params: { path: { unitId } } }
    const before = (await audits(unitId)).length

    const underOffer = await unwrap(apiAs('admin', 'a').PATCH('/api/v1/units/{unitId}', { ...path, body: { occupancyStatus: 'under_offer' } }))
    expect(underOffer).toMatchObject({ occupancyStatus: 'under_offer', unitNumber: number('A'), floorAreaSqm: 12.5 })
    const afterOccupancy = await audits(unitId)
    expect(afterOccupancy).toHaveLength(before + 1)
    expect(afterOccupancy.at(-1)).toEqual({
      action: 'update',
      summary: `Unit ${number('A')} in ${property().name} changed from vacant to under offer`,
      changes: [{ field: 'occupancy_status', before: 'vacant', after: 'under_offer' }],
    })

    const renamed = await unwrap(apiAs('manager', 'a').PATCH('/api/v1/units/{unitId}', { ...path, body: { floor: 'Ground', floorAreaSqm: 14 } }))
    expect(renamed).toMatchObject({ floor: 'Ground', floorAreaSqm: 14, occupancyStatus: 'under_offer' })
    expect(await audits(unitId)).toHaveLength(before + 2)
  }, SLOW)

  it('refuses a number already used in the property (409) and a property move (400)', async () => {
    const path = { params: { path: { unitId: created() } } }
    const taken = world().companies.a.units.find((u) => u.propertyId === property().id)!
    const duplicate = await apiErrorOf(unwrap(apiAs('manager', 'a').PATCH('/api/v1/units/{unitId}', { ...path, body: { unitNumber: taken.unitNumber } })))
    expect(duplicate.status).toBe(409)

    const otherProperty = world().companies.a.properties.find((p) => p.id !== property().id)!
    const move = await apiErrorOf(unwrap(apiAs('manager', 'a').PATCH('/api/v1/units/{unitId}', { ...path, body: { propertyId: otherProperty.id } as never })))
    expect(move.status).toBe(400)
  })

  it('refuses writes from members who only read (403) and does not find another company’s unit (404)', async () => {
    const unitId = created()
    const path = { params: { path: { unitId } } }
    const auditsBefore = (await audits(unitId)).length
    for (const user of ['readOnly', 'owner'] as const) {
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').PATCH('/api/v1/units/{unitId}', { ...path, body: { occupancyStatus: 'vacant' } })))).status).toBe(403)
    }
    expect((await apiErrorOf(unwrap(apiAs('manager', 'b').PATCH('/api/v1/units/{unitId}', { ...path, body: { occupancyStatus: 'vacant' } })))).status).toBe(404)
    expect((await apiErrorOf(unwrap(apiAs('admin', 'b').PATCH('/api/v1/units/{unitId}', { ...path, body: { occupancyStatus: 'vacant' } })))).status).toBe(403)
    expect(await audits(unitId)).toHaveLength(auditsBefore)
  }, SLOW)

  it('keeps the units of an archived property read-only and adds none to it (422)', async () => {
    const a = world().companies.a.id
    const inserted = check(
      await serviceRole()
        .from('properties')
        .insert({
          company_id: a,
          name: `Archived ${integration().runId}`,
          code: 'ZUARC',
          type: 'retail',
          address_line1: '1 Road',
          suburb: 'Soweto',
          city: 'Johannesburg',
          province: 'Gauteng',
          postal_code: '1804',
          gross_lettable_area_sqm: 500,
          manager_user_id: world().users.manager.id,
          accounting_system: 'MRI',
        })
        .select('id')
        .single(),
      'Insert a property to archive',
    )
    archivedPropertyId = inserted.id
    const unit = await unwrap(apiAs('manager', 'a').POST('/api/v1/units', { body: { ...newUnit(number('D')), propertyId: inserted.id } }))
    expectOk(await serviceRole().from('properties').update({ status: 'archived' }).eq('id', inserted.id), 'Archive the property')

    const message = 'This property is archived. Restore it before adding or changing its units.'
    const edit = await apiErrorOf(unwrap(apiAs('manager', 'a').PATCH('/api/v1/units/{unitId}', { params: { path: { unitId: unit.id } }, body: { occupancyStatus: 'unavailable' } })))
    expect(edit.status).toBe(422)
    expect(edit.messages.join(' ')).toBe(message)
    const add = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/units', { body: { ...newUnit(number('E')), propertyId: inserted.id } })))
    expect(add.status).toBe(422)
    expect(add.messages.join(' ')).toBe(message)
  })
})
