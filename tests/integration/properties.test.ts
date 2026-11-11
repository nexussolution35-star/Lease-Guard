import { unwrap } from '@leaseguard/api-client'
import { afterAll, describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { auditCount, snapshotRow } from './support/local-db.ts'

/**
 * Property management (PRD module 2) through the real API and the local database: writers create, edit, archive and
 * restore properties; members who only read are refused; another company's property is not found; the database rules
 * (manager role, unique code, no archive while a lease has not ended, archived is read-only) answer in words; and every
 * change reaches the audit log.
 */

// Codes this file creates: unique per run would need 8+ characters, so a fixed prefix outside the world's codes.
const CODES = ['ZQA', 'ZQB'] as const

/** The id of the property the first test creates; the later tests change it. */
let createdId: string | undefined

afterAll(async () => {
  // destroyWorld removes company rows too; remove this file's properties explicitly so later files see the world's set.
  expectOk(
    await serviceRole().from('properties').delete().eq('company_id', world().companies.a.id).in('code', [...CODES]),
    'Delete this file’s properties',
  )
})

const newProperty = (code: string) => ({
  name: `Integration ${code} ${integration().runId}`,
  code: code.toLowerCase(),
  type: 'office' as const,
  address: { line1: '1 Cradock Avenue', suburb: 'Rosebank', city: 'Johannesburg', province: 'Gauteng' as const, postalCode: '2196' },
  grossLettableAreaSqm: 4200.5,
  managerUserId: world().users.manager.id,
  ownerUserId: world().users.owner.id,
  accountingSystem: 'Sage' as const,
})

describe('properties: create', () => {
  it('lets a property manager create a property, upper-casing the code and recording the audit entry', async () => {
    const property = await unwrap(apiAs('manager', 'a').POST('/api/v1/properties', { body: newProperty(CODES[0]) }))
    expect(property).toMatchObject({
      companyId: world().companies.a.id,
      code: 'ZQA',
      status: 'active',
      description: '',
      grossLettableAreaSqm: 4200.5,
      managerUserId: world().users.manager.id,
      ownerUserId: world().users.owner.id,
      address: { line1: '1 Cradock Avenue', postalCode: '2196', country: 'South Africa' },
    })
    expect(await auditCount(property.id)).toBe(1)
    createdId = property.id

    const fetched = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/properties/{propertyId}', { params: { path: { propertyId: property.id } } }))
    expect(fetched.name).toBe(property.name)
  })

  it('refuses a code already used in the company (409) and a manager who only reads (422)', async () => {
    const duplicate = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/properties', { body: { ...newProperty(CODES[0]), code: 'ACP' } })))
    expect(duplicate.status).toBe(409)
    expect(duplicate.messages.join(' ')).toBe('A property with the code ACP already exists in this workspace')

    const readOnlyManager = await apiErrorOf(
      unwrap(apiAs('admin', 'a').POST('/api/v1/properties', { body: { ...newProperty(CODES[1]), managerUserId: world().users.readOnly.id } })),
    )
    expect(readOnlyManager.status).toBe(422)
    expect(readOnlyManager.messages.join(' ')).toMatch(/must be a company admin or property manager/)

    const outsider = await apiErrorOf(
      unwrap(apiAs('manager', 'b').POST('/api/v1/properties', { body: { ...newProperty(CODES[1]), managerUserId: world().users.admin.id, ownerUserId: null } })),
    )
    expect(outsider.status).toBe(422)
  })

  it('validates the body (400) and refuses members who only read (403)', async () => {
    const invalid = await apiErrorOf(
      unwrap(apiAs('admin', 'a').POST('/api/v1/properties', { body: { ...newProperty(CODES[1]), code: 'x', grossLettableAreaSqm: 0 } })),
    )
    expect(invalid.status).toBe(400)
    expect(invalid.messages.join(' ')).toMatch(/code: must be 2 to 8 letters or digits/)

    for (const user of ['readOnly', 'owner'] as const) {
      const refused = await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/properties', { body: newProperty(CODES[1]) })))
      expect(refused.status).toBe(403)
    }
  })
})

describe('properties: edit, archive and restore', () => {
  /** The property the create test added, read fresh from the API. */
  const created = async () => {
    if (!createdId) throw new Error('The create test did not run or failed')
    return unwrap(apiAs('manager', 'a').GET('/api/v1/properties/{propertyId}', { params: { path: { propertyId: createdId } } }))
  }

  it('edits only the fields sent and audits the change', async () => {
    const property = await created()
    const before = await auditCount(property.id)
    const edited = await unwrap(
      apiAs('admin', 'a').PATCH('/api/v1/properties/{propertyId}', {
        params: { path: { propertyId: property.id } },
        body: { name: `${property.name} North`, ownerUserId: null, status: 'under_development' },
      }),
    )
    expect(edited).toMatchObject({ name: `${property.name} North`, status: 'under_development', code: 'ZQA', grossLettableAreaSqm: 4200.5 })
    expect(edited).not.toHaveProperty('ownerUserId')
    expect(await auditCount(property.id)).toBe(before + 1)
  })

  it('archives and restores a property without leases, and keeps an archived property read-only', async () => {
    const property = await created()
    const path = { params: { path: { propertyId: property.id } } }

    const archived = await unwrap(apiAs('manager', 'a').POST('/api/v1/properties/{propertyId}/archive', path))
    expect(archived.status).toBe('archived')
    const again = await unwrap(apiAs('manager', 'a').POST('/api/v1/properties/{propertyId}/archive', path))
    expect(again.status).toBe('archived')

    const before = await snapshotRow('properties', property.id)
    const locked = await apiErrorOf(unwrap(apiAs('manager', 'a').PATCH('/api/v1/properties/{propertyId}', { ...path, body: { name: 'Renamed while archived' } })))
    expect(locked.status).toBe(422)
    expect(locked.messages.join(' ')).toBe('This property is archived. Restore it before changing it.')
    expect(await snapshotRow('properties', property.id)).toEqual(before)
    // Changing the status in an edit does not get round it: only the restore action takes it out of archived.
    const restoreAndEdit = await apiErrorOf(
      unwrap(apiAs('manager', 'a').PATCH('/api/v1/properties/{propertyId}', { ...path, body: { status: 'under_development', name: 'Renamed while archived' } })),
    )
    expect(restoreAndEdit.status).toBe(422)
    expect(await snapshotRow('properties', property.id)).toEqual(before)

    const restored = await unwrap(apiAs('manager', 'a').POST('/api/v1/properties/{propertyId}/restore', path))
    expect(restored.status).toBe('active')
  })

  it('refuses to archive a property with a lease that has not ended (409) and changes nothing', async () => {
    const withLease = world().companies.a.properties.find((p) => p.code === 'ACP')!
    const before = await snapshotRow('properties', withLease.id)
    const audits = await auditCount(withLease.id)
    const refused = await apiErrorOf(
      unwrap(apiAs('manager', 'a').POST('/api/v1/properties/{propertyId}/archive', { params: { path: { propertyId: withLease.id } } })),
    )
    expect(refused.status).toBe(409)
    expect(refused.messages.join(' ')).toMatch(/still has leases that have not ended/)
    expect(await snapshotRow('properties', withLease.id)).toEqual(before)
    expect(await auditCount(withLease.id)).toBe(audits)
  })

  it('refuses writes from members who only read (403) and does not find another company’s property (404)', async () => {
    const property = await created()
    const path = { params: { path: { propertyId: property.id } } }
    const before = await snapshotRow('properties', property.id)
    for (const user of ['readOnly', 'owner'] as const) {
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').PATCH('/api/v1/properties/{propertyId}', { ...path, body: { name: 'X' } })))).status).toBe(403)
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/properties/{propertyId}/archive', path)))).status).toBe(403)
    }
    // The manager also manages company B: under B, A's property does not exist.
    expect((await apiErrorOf(unwrap(apiAs('manager', 'b').PATCH('/api/v1/properties/{propertyId}', { ...path, body: { name: 'X' } })))).status).toBe(404)
    expect((await apiErrorOf(unwrap(apiAs('manager', 'b').POST('/api/v1/properties/{propertyId}/archive', path)))).status).toBe(404)
    // The admin of A is not a member of B.
    expect((await apiErrorOf(unwrap(apiAs('admin', 'b').PATCH('/api/v1/properties/{propertyId}', { ...path, body: { name: 'X' } })))).status).toBe(403)
    expect(await snapshotRow('properties', property.id)).toEqual(before)
  })
})

describe('monitoring events: open filter', () => {
  // One resolved event on a world property, so the filter has something to leave out; removed afterwards.
  let resolvedId: string | undefined
  afterAll(async () => {
    if (resolvedId) expectOk(await serviceRole().from('monitoring_events').delete().eq('id', resolvedId), 'Delete the resolved event')
  })

  it('lists the events that still need attention for one property, and leaves out resolved ones', async () => {
    const property = world().companies.a.properties[0]!
    const inserted = await serviceRole()
      .from('monitoring_events')
      .insert({
        company_id: world().companies.a.id,
        type: 'lease_expiry',
        property_id: property.id,
        title: `Resolved event ${integration().runId}`,
        description: 'Resolved before this test ran.',
        identified_on: '2026-10-01',
        priority: 'low',
        recommended_action: 'None.',
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    expectOk(inserted, 'Insert a resolved event')
    resolvedId = (inserted.data as { id: string }).id

    const query = (open?: boolean) =>
      unwrap(apiAs('readOnly', 'a').GET('/api/v1/monitoring/events', { params: { query: { propertyId: property.id, pageSize: 100, ...(open === undefined ? {} : { open }) } } }))
    const [open, closed, all] = await Promise.all([query(true), query(false), query()])

    expect(open.total).toBeGreaterThan(0)
    expect(open.items.some((event) => event.id === resolvedId)).toBe(false)
    expect(open.items.every((event) => ['new', 'under_review', 'action_required', 'in_progress'].includes(event.status))).toBe(true)
    expect(closed.items.map((event) => event.id)).toContain(resolvedId)
    expect(closed.items.every((event) => ['resolved', 'dismissed'].includes(event.status))).toBe(true)
    expect(open.total + closed.total).toBe(all.total)
  })
})
