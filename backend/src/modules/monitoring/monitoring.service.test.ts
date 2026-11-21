import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import { toMonitoringEvent, type MonitoringEventRow } from './monitoring.mapper'
import { monitoringEventListQuerySchema, updateMonitoringEventStatusBodySchema } from './monitoring.schemas'
import { MonitoringService } from './monitoring.service'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const EVENT = '6f1d2c1e-0000-4000-8000-0000000000aa'
const LEASE = '6f1d2c1e-0000-4000-8000-0000000000bb'
const UNIT = '6f1d2c1e-0000-4000-8000-0000000000dd'
const TENANT = '6f1d2c1e-0000-4000-8000-0000000000ee'
const USER = '6f1d2c1e-0000-4000-8000-0000000000ff'

function eventRow(overrides: Partial<MonitoringEventRow> = {}): MonitoringEventRow {
  return {
    id: EVENT,
    company_id: COMPANY,
    type: 'rental_escalation_discrepancy',
    property_id: '6f1d2c1e-0000-4000-8000-0000000000cc',
    unit_id: null,
    tenant_id: null,
    lease_id: LEASE,
    lease_reference: 'MSQ-L-012',
    statement_id: null,
    arrangement_id: null,
    rule_id: null,
    title: 'Escalation not applied',
    description: 'October rental does not include the 8% escalation',
    calculation: { expectedAmount: 37_800, actualAmount: 35_000, difference: 2_800, steps: ['R35 000 × 1.08 = R37 800'] },
    identified_on: '2026-11-01',
    due_date: null,
    priority: 'high',
    recommended_action: 'Ask the accountant to correct the rental charge',
    assigned_to_user_id: null,
    status: 'new',
    resolved_at: null,
    resolved_by_user_id: null,
    resolution_notes: null,
    dismissal_reason: null,
    dismissed_by_user_id: null,
    dismissed_at: null,
    dedupe_key: null,
    created_at: '2026-11-01T08:00:00+00:00',
    updated_at: '2026-11-01T08:00:00+00:00',
    ...overrides,
  }
}

describe('monitoring mapper', () => {
  it('maps the explainable calculation and leaves absent fields out', () => {
    const event = toMonitoringEvent(eventRow())
    expect(event.calculation).toEqual({ expectedAmount: 37_800, actualAmount: 35_000, difference: 2_800, steps: ['R35 000 × 1.08 = R37 800'] })
    for (const absent of ['unitId', 'dueDate', 'resolvedAt', 'resolutionNotes', 'dismissal']) expect(event).not.toHaveProperty(absent)
  })

  it('groups the dismissal columns', () => {
    const event = toMonitoringEvent(
      eventRow({ status: 'dismissed', dismissal_reason: 'Agreed with owner', dismissed_by_user_id: 'u1', dismissed_at: '2026-11-02T08:00:00+00:00' }),
    )
    expect(event.dismissal).toEqual({ reason: 'Agreed with owner', dismissedByUserId: 'u1', dismissedAt: '2026-11-02T08:00:00+00:00' })
  })

  it('refuses a malformed calculation instead of dropping it', () => {
    expect(() => toMonitoringEvent(eventRow({ calculation: { steps: 'not a list' } }))).toThrow(/malformed/)
  })
})

describe('MonitoringService', () => {
  const service = new MonitoringService()

  it('lists one company with every filter', async () => {
    const { client, queries } = fakeDb(() => ({ data: [eventRow()], error: null, count: 1 }))
    const query = monitoringEventListQuerySchema.parse({
      status: 'new',
      priority: 'high',
      type: 'rental_escalation_discrepancy',
      leaseId: LEASE,
      sort: 'priority',
      direction: 'desc',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page.items[0]).toMatchObject({ id: EVENT, leaseReference: 'MSQ-L-012' })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'new'],
      ['priority', 'high'],
      ['type', 'rental_escalation_discrepancy'],
      ['lease_id', LEASE],
    ])
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['priority', { ascending: false }])
  })

  it('filters open events (still needing attention) and closed ones', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ open: 'true', propertyId: LEASE }))
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ open: 'false' }))
    expect(callsTo(queries[0]!, 'in')).toEqual([['status', ['new', 'under_review', 'action_required', 'in_progress']]])
    expect(callsTo(queries[0]!, 'eq')).toContainEqual(['property_id', LEASE])
    expect(callsTo(queries[1]!, 'in')).toEqual([['status', ['resolved', 'dismissed']]])
    expect(monitoringEventListQuerySchema.safeParse({ open: 'yes' }).success).toBe(false)
  })

  it('names the property, unit, tenant and assignee of each row, and leaves absent ones out', async () => {
    const { client, queries } = fakeDb(() => ({
      data: [
        {
          ...eventRow({ unit_id: UNIT, tenant_id: TENANT, assigned_to_user_id: USER }),
          property: { name: 'Mall of the South' },
          unit: { unit_number: 'G12' },
          tenant: { trading_name: 'Bean There' },
          assignee: { profile: { full_name: 'Thandi Mokoena' } },
        },
        { ...eventRow({ id: LEASE }), property: { name: 'Mall of the South' }, unit: null, tenant: null, assignee: null },
      ],
      error: null,
      count: 2,
    }))
    const page = await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({}))

    expect(page.items[0]).toMatchObject({
      propertyName: 'Mall of the South',
      unitNumber: 'G12',
      tenantName: 'Bean There',
      assigneeName: 'Thandi Mokoena',
      assignedToUserId: USER,
    })
    for (const absent of ['unitNumber', 'tenantName', 'assigneeName']) expect(page.items[1]).not.toHaveProperty(absent)
    // The embeds are not leaked into the event's own fields.
    for (const embed of ['property', 'unit', 'tenant', 'assignee']) expect(page.items[0]).not.toHaveProperty(embed)
    expect(callsTo(queries[0]!, 'select')[0]![0]).toContain('assignee:company_users!monitoring_events_assigned_to_fk')
  })

  it('filters by one payment arrangement on the server', async () => {
    const ARRANGEMENT = '6f1d2c1e-0000-4000-8000-0000000000a7'
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ type: 'arrangement_attention', arrangementId: ARRANGEMENT }))
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['type', 'arrangement_attention'],
      ['arrangement_id', ARRANGEMENT],
    ])
    expect(monitoringEventListQuerySchema.safeParse({ arrangementId: 'ARR-1' }).success).toBe(false)
  })

  it('filters by unit, tenant and one assignee or the unassigned', async () => {
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ unitId: UNIT, tenantId: TENANT, assignee: USER }))
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ assignee: 'unassigned' }))
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['unit_id', UNIT],
      ['tenant_id', TENANT],
      ['assigned_to_user_id', USER],
    ])
    expect(callsTo(queries[1]!, 'is')).toEqual([['assigned_to_user_id', null]])
    expect(callsTo(queries[1]!, 'eq')).toEqual([['company_id', COMPANY]])
    expect(monitoringEventListQuerySchema.safeParse({ assignee: 'someone' }).success).toBe(false)
    expect(monitoringEventListQuerySchema.safeParse({ unitId: 'G12' }).success).toBe(false)
  })

  it('turns a due window into a due-date range on the South African date', async () => {
    // 22:30 UTC on 20 Nov is already 21 Nov in South Africa.
    const now = new Date('2026-11-20T22:30:00Z')
    const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ due: 'overdue' }), now)
    await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ due: 'next_30_days' }), now)
    expect(callsTo(queries[0]!, 'gte')).toEqual([])
    expect(callsTo(queries[0]!, 'lte')).toEqual([['due_date', '2026-11-20']])
    expect(callsTo(queries[1]!, 'gte')).toEqual([['due_date', '2026-11-21']])
    expect(callsTo(queries[1]!, 'lte')).toEqual([['due_date', '2026-12-21']])
    expect(monitoringEventListQuerySchema.safeParse({ due: 'next_year' }).success).toBe(false)
  })

  it('sorts events without a due date last only for the nullable due_date column', async () => {
    for (const [sort, direction, expected] of [
      ['dueDate', 'desc', ['due_date', { ascending: false, nullsFirst: false }]],
      ['dueDate', 'asc', ['due_date', { ascending: true, nullsFirst: false }]],
      ['identifiedOn', 'desc', ['identified_on', { ascending: false }]],
      ['createdAt', 'desc', ['created_at', { ascending: false }]],
      [undefined, 'asc', ['identified_on', { ascending: true }]],
    ] as const) {
      const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
      await service.list(client, COMPANY, monitoringEventListQuerySchema.parse({ sort, direction }))
      expect(callsTo(queries[0]!, 'order')).toEqual([expected, ['id', { ascending: true }]])
    }
  })

  it('gets one event of the company with the names of its property, unit, tenant and assignee', async () => {
    const { client, queries } = fakeDb(() => ({
      data: {
        ...eventRow({ unit_id: UNIT, tenant_id: TENANT, assigned_to_user_id: USER }),
        property: { name: 'Mall of the South' },
        unit: { unit_number: 'G12' },
        tenant: { trading_name: 'Bean There' },
        assignee: { profile: { full_name: 'Thandi Mokoena' } },
      },
      error: null,
    }))

    const event = await service.get(client, COMPANY, EVENT)

    expect(event).toMatchObject({ id: EVENT, propertyName: 'Mall of the South', unitNumber: 'G12', tenantName: 'Bean There', assigneeName: 'Thandi Mokoena' })
    expect(event.calculation).toEqual({ expectedAmount: 37_800, actualAmount: 35_000, difference: 2_800, steps: ['R35 000 × 1.08 = R37 800'] })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', EVENT],
    ])
    expect(callsTo(queries[0]!, 'select')[0]![0]).toContain('property:properties!monitoring_events_property_fk(name)')
  })

  it('returns 404 when the event is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, EVENT)).rejects.toBeInstanceOf(NotFoundException)
  })

  const STATUS_RPC = 'rpc:update_monitoring_event_status'

  /** The status change is the database function; the event is then read back as the detail screen shows it. */
  function statusDb(after: Partial<MonitoringEventRow> | null, refusal?: { code: string; message: string }) {
    return fakeDb((query) => {
      if (query.table === STATUS_RPC) return refusal ? { data: null, error: refusal } : { data: EVENT, error: null }
      return {
        data: after === null ? null : { ...eventRow(after), property: { name: 'Mall of the South' }, unit: null, tenant: { trading_name: 'Bean There' }, assignee: null },
        error: null,
      }
    })
  }

  it('dismisses through the database function with the reason; the database stamps who and when', async () => {
    const { client, queries } = statusDb({
      status: 'dismissed',
      dismissal_reason: 'Duplicate',
      dismissed_by_user_id: 'u1',
      dismissed_at: '2026-11-02T08:00:00+00:00',
    })
    const body = updateMonitoringEventStatusBodySchema.parse({ status: 'dismissed', note: ' Duplicate ' })

    const event = await service.updateStatus(client, COMPANY, EVENT, body)

    expect(event.status).toBe('dismissed')
    expect(event.dismissal).toEqual({ reason: 'Duplicate', dismissedByUserId: 'u1', dismissedAt: '2026-11-02T08:00:00+00:00' })
    expect(queries.map((query) => query.table)).toEqual([STATUS_RPC, 'monitoring_events'])
    expect(rpcArgs(queries[0]!)).toEqual({ p_company_id: COMPANY, p_event_id: EVENT, p_status: 'dismissed', p_note: 'Duplicate' })
    // The table itself is never updated by the API (signed-in users hold no UPDATE on it).
    expect(queries.some((query) => callsTo(query, 'update').length > 0)).toBe(false)
    // The changed event comes back as the detail screen shows it, with its names.
    expect(event.tenantName).toBe('Bean There')
    expect(callsTo(queries[1]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', EVENT],
    ])
  })

  it('sends a note on other statuses (the resolution notes), and no note without one', async () => {
    const resolve = statusDb({ status: 'resolved', resolved_at: '2026-11-02T08:00:00+00:00', resolution_notes: 'Corrected' })
    await service.updateStatus(resolve.client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'resolved', note: 'Corrected' }))
    expect(rpcArgs(resolve.queries[0]!)).toEqual({ p_company_id: COMPANY, p_event_id: EVENT, p_status: 'resolved', p_note: 'Corrected' })

    const review = statusDb({ status: 'under_review' })
    await service.updateStatus(review.client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'under_review' }))
    expect(rpcArgs(review.queries[0]!)).toEqual({ p_company_id: COMPANY, p_event_id: EVENT, p_status: 'under_review' })
  })

  it('answers 409 with the database message for a move the workflow does not allow, without reading the event', async () => {
    const { client, queries } = statusDb(null, { code: 'P0001', message: 'An event cannot move from "dismissed" to "under review".' })
    await expect(
      service.updateStatus(client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'under_review' })),
    ).rejects.toMatchObject({ status: 409, message: 'An event cannot move from "dismissed" to "under review".' })
    expect(queries).toHaveLength(1)
  })

  it('answers 404 for an event that is not in the company, 403 for a caller who cannot write and 422 for a bad note', async () => {
    for (const [code, status] of [
      ['P0002', 404],
      ['42501', 403],
      ['22023', 422],
    ] as const) {
      const { client } = statusDb(null, { code, message: 'refused' })
      await expect(
        service.updateStatus(client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'in_progress' })),
      ).rejects.toMatchObject({ status })
    }
  })
})

describe('updateMonitoringEventStatusBodySchema', () => {
  it('requires a reason to dismiss and never allows moving back to new', () => {
    expect(updateMonitoringEventStatusBodySchema.safeParse({ status: 'dismissed' }).success).toBe(false)
    expect(updateMonitoringEventStatusBodySchema.safeParse({ status: 'dismissed', note: '   ' }).success).toBe(false)
    expect(updateMonitoringEventStatusBodySchema.safeParse({ status: 'new' }).success).toBe(false)
    expect(updateMonitoringEventStatusBodySchema.safeParse({ status: 'resolved', extra: 1 }).success).toBe(false)
  })
})
