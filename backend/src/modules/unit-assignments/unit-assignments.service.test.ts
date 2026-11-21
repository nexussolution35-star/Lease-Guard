import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { toUnitAssignmentListItem, UNIT_ASSIGNMENT_SELECT } from './unit-assignments.mapper'
import { createUnitAssignmentBodySchema, unitAssignmentListQuerySchema } from './unit-assignments.schemas'
import { UnitAssignmentsService } from './unit-assignments.service'
import { ASSIGNMENT, assignmentListRow, COMPANY, TENANT, UNIT } from './unit-assignments.test-helpers'

describe('UnitAssignmentsService', () => {
  const service = new UnitAssignmentsService()

  it('lists one company’s assignments, newest first, with filters', async () => {
    const { client, queries } = fakeDb(() => ({ data: [assignmentListRow], error: null, count: 1 }))
    const page = await service.list(client, COMPANY, unitAssignmentListQuerySchema.parse({ tenantId: TENANT, unitId: UNIT, current: 'true' }))

    expect(page.items).toEqual([expect.objectContaining({ id: ASSIGNMENT, tenantName: 'Thrifty Foods', unitNumber: 'G12', propertyName: 'Maponya Square' })])
    const [q] = queries
    expect(q?.table).toBe('unit_tenant_assignments')
    expect(callsTo(q!, 'select')).toEqual([[UNIT_ASSIGNMENT_SELECT, { count: 'exact' }]])
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['tenant_id', TENANT],
      ['unit_id', UNIT],
    ])
    expect(callsTo(q!, 'is')).toEqual([['ended_at', null]])
    expect(callsTo(q!, 'order')[0]).toEqual(['assigned_at', { ascending: false }])
  })

  it('lists ended assignments only when asked', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, unitAssignmentListQuerySchema.parse({ current: 'false', sort: 'assignedAt', direction: 'asc' }))
    expect(callsTo(queries[0]!, 'not')).toEqual([['ended_at', 'is', null]])
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['assigned_at', { ascending: true }])
  })

  it('rejects malformed filters and bodies', () => {
    expect(unitAssignmentListQuerySchema.safeParse({ tenantId: 'nope' }).success).toBe(false)
    expect(unitAssignmentListQuerySchema.safeParse({ current: 'yes' }).success).toBe(false)
    expect(createUnitAssignmentBodySchema.safeParse({ tenantId: TENANT }).success).toBe(false)
    expect(createUnitAssignmentBodySchema.safeParse({ tenantId: TENANT, unitId: UNIT, propertyId: UNIT }).success).toBe(false)
  })

  it('assigns through the database function and returns the assignment', async () => {
    const { client, queries } = fakeDb((query) =>
      query.table === 'rpc:assign_tenant_to_unit' ? { data: ASSIGNMENT, error: null } : { data: assignmentListRow, error: null },
    )
    await expect(service.assign(client, COMPANY, { tenantId: TENANT, unitId: UNIT })).resolves.toMatchObject({ id: ASSIGNMENT, tenantId: TENANT })
    expect(callsTo(queries[0]!, 'rpc')).toEqual([[{ p_company_id: COMPANY, p_tenant_id: TENANT, p_unit_id: UNIT }]])
    expect(callsTo(queries[1]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', ASSIGNMENT],
    ])
  })

  it('answers a refusal that names who holds the unit with 409 and its words', async () => {
    const message = 'Unit G12 is assigned to Kasi Flame Grill. Unassign it before assigning it to another tenant.'
    const { client } = fakeDb(() => ({ data: null, error: { code: 'P0001', message } }))
    const error = await service.assign(client, COMPANY, { tenantId: TENANT, unitId: UNIT }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toBe(message)
  })

  it('answers a tenant or unit of another company with 404 and a non-writer with 403', async () => {
    const notFound = fakeDb(() => ({ data: null, error: { code: 'P0002', message: 'The unit is not in this workspace' } }))
    await expect(service.assign(notFound.client, COMPANY, { tenantId: TENANT, unitId: UNIT })).rejects.toBeInstanceOf(NotFoundException)
    const forbidden = fakeDb(() => ({ data: null, error: { code: '42501', message: 'Only company admins and property managers can assign tenants to units' } }))
    await expect(service.assign(forbidden.client, COMPANY, { tenantId: TENANT, unitId: UNIT })).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('unassigns through the database function and returns the ended assignment', async () => {
    const ended = { ...assignmentListRow, ended_at: '2026-11-22T08:00:00+00:00', ended_by_user_id: assignmentListRow.assigned_by_user_id }
    const { client, queries } = fakeDb((query) =>
      query.table === 'rpc:end_unit_tenant_assignment' ? { data: ASSIGNMENT, error: null } : { data: ended, error: null },
    )
    await expect(service.end(client, COMPANY, ASSIGNMENT)).resolves.toMatchObject({ endedAt: ended.ended_at })
    expect(callsTo(queries[0]!, 'rpc')).toEqual([[{ p_company_id: COMPANY, p_assignment_id: ASSIGNMENT }]])
  })

  it('answers an assignment that already ended with 409', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'P0001', message: 'This assignment has already ended.' } }))
    await expect(service.end(client, COMPANY, ASSIGNMENT)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('toUnitAssignmentListItem', () => {
  it('names the tenant, unit and property and leaves absent stamps out', () => {
    const item = toUnitAssignmentListItem(assignmentListRow)
    expect(item).toEqual({
      id: ASSIGNMENT,
      companyId: COMPANY,
      propertyId: assignmentListRow.property_id,
      unitId: UNIT,
      tenantId: TENANT,
      assignedAt: assignmentListRow.assigned_at,
      assignedByUserId: assignmentListRow.assigned_by_user_id,
      tenantName: 'Thrifty Foods',
      unitNumber: 'G12',
      propertyName: 'Maponya Square',
      createdAt: assignmentListRow.created_at,
      updatedAt: assignmentListRow.updated_at,
    })
  })
})
