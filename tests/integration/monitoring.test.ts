import { unwrap } from '@leaseguard/api-client'
import { canTransition } from '@leaseguard/domain'
import { beforeAll, describe, expect, it } from 'vitest'

import type { WorldMonitoringEvent } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, world } from './support/clients.ts'
import { auditCount, snapshotRow, type RowSnapshot } from './support/local-db.ts'

/** A monitoring event in status `new` that the world created in company A. */
let event: WorldMonitoringEvent
let original: RowSnapshot
let auditBefore = 0

beforeAll(async () => {
  const candidate = world().companies.a.monitoringEvents[0]
  if (!candidate) throw new Error('The world has no monitoring event in company A')
  event = candidate
  original = await snapshotRow('monitoring_events', event.id)
  expect(original.status, 'world event starts as new').toBe('new')
  auditBefore = await auditCount(event.id)
})

describe('monitoring event status workflow (PATCH /monitoring/events/{id}/status)', () => {
  const path = '/api/v1/monitoring/events/{eventId}/status'

  it('refuses a read_only member (403)', async () => {
    const error = await apiErrorOf(
      unwrap(apiAs('readOnly', 'a').PATCH(path, { params: { path: { eventId: event.id } }, body: { status: 'under_review' } })),
    )
    expect(error.status).toBe(403)
  })

  it('requires a reason to dismiss (400) and changes nothing', async () => {
    const error = await apiErrorOf(
      unwrap(apiAs('manager', 'a').PATCH(path, { params: { path: { eventId: event.id } }, body: { status: 'dismissed' } })),
    )
    expect(error.status).toBe(400)
    expect(await snapshotRow('monitoring_events', event.id)).toEqual(original)
  })

  it('applies an allowed move (new → under_review) and records it', async () => {
    expect(canTransition('new', 'under_review')).toBe(true)
    const updated = await unwrap(
      apiAs('manager', 'a').PATCH(path, {
        params: { path: { eventId: event.id } },
        body: { status: 'under_review', note: 'Integration test: picked up for review' },
      }),
    )
    expect(updated.id).toBe(event.id)
    expect(updated.status).toBe('under_review')
    expect(updated.resolutionNotes).toBe('Integration test: picked up for review')
    expect(await auditCount(event.id)).toBe(auditBefore + 1)
  })

  it('refuses a move the workflow does not allow (under_review → resolved) with 409', async () => {
    expect(canTransition('under_review', 'resolved')).toBe(false)
    const error = await apiErrorOf(
      unwrap(apiAs('manager', 'a').PATCH(path, { params: { path: { eventId: event.id } }, body: { status: 'resolved' } })),
    )
    expect(error.status).toBe(409)
    const current = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/monitoring/events/{eventId}', { params: { path: { eventId: event.id } } }),
    )
    expect(current.status).toBe('under_review')
  })
})
