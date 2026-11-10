import { ConflictException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { toMonitoringEvent, type MonitoringEventRow } from './monitoring.mapper'
import { monitoringEventListQuerySchema, updateMonitoringEventStatusBodySchema } from './monitoring.schemas'
import { MonitoringService } from './monitoring.service'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const EVENT = '6f1d2c1e-0000-4000-8000-0000000000aa'
const LEASE = '6f1d2c1e-0000-4000-8000-0000000000bb'

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

  it('returns 404 when the event is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, EVENT)).rejects.toBeInstanceOf(NotFoundException)
  })

  /** First query reads the current event, the second is the update. */
  function updateDb(current: Partial<MonitoringEventRow>, updated: Partial<MonitoringEventRow> | null) {
    return fakeDb((query) =>
      query.calls.some(([method]) => method === 'update')
        ? { data: updated === null ? null : eventRow(updated), error: null }
        : { data: eventRow(current), error: null },
    )
  }

  it('records a dismissal reason from the checked status; the database stamps who and when', async () => {
    const { client, queries } = updateDb(
      { status: 'under_review' },
      { status: 'dismissed', dismissal_reason: 'Duplicate', dismissed_by_user_id: 'u1', dismissed_at: '2026-11-02T08:00:00+00:00' },
    )
    const body = updateMonitoringEventStatusBodySchema.parse({ status: 'dismissed', note: ' Duplicate ' })

    const event = await service.updateStatus(client, COMPANY, EVENT, body)

    expect(event.status).toBe('dismissed')
    expect(callsTo(queries[1]!, 'update')).toEqual([[{ status: 'dismissed', dismissal_reason: 'Duplicate' }]])
    expect(callsTo(queries[1]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', EVENT],
      ['status', 'under_review'],
    ])
  })

  it('stores a note on other statuses as resolution notes, and sends nothing extra without one', async () => {
    const resolve = updateDb({ status: 'in_progress' }, { status: 'resolved', resolved_at: '2026-11-02T08:00:00+00:00' })
    await service.updateStatus(resolve.client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'resolved', note: 'Corrected' }))
    expect(callsTo(resolve.queries[1]!, 'update')).toEqual([[{ status: 'resolved', resolution_notes: 'Corrected' }]])

    const review = updateDb({ status: 'new' }, { status: 'under_review' })
    await service.updateStatus(review.client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'under_review' }))
    expect(callsTo(review.queries[1]!, 'update')).toEqual([[{ status: 'under_review' }]])
  })

  it('refuses moves the workflow does not allow, without writing', async () => {
    for (const [from, to] of [
      ['dismissed', 'resolved'],
      ['resolved', 'in_progress'],
      ['new', 'resolved'],
    ] as const) {
      const { client, queries } = updateDb({ status: from }, { status: to })
      await expect(
        service.updateStatus(client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: to, note: 'x' })),
      ).rejects.toBeInstanceOf(ConflictException)
      expect(queries).toHaveLength(1)
    }
  })

  it('returns 409 when someone else changed the status in between', async () => {
    const { client } = updateDb({ status: 'new' }, null)
    await expect(
      service.updateStatus(client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'under_review' })),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('returns 404 when the event to update is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(
      service.updateStatus(client, COMPANY, EVENT, updateMonitoringEventStatusBodySchema.parse({ status: 'in_progress' })),
    ).rejects.toBeInstanceOf(NotFoundException)
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
