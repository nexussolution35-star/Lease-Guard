import { unwrap } from '@leaseguard/api-client'
import { canTransition, MONITORING_EVENT_STATUSES } from '@leaseguard/domain'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import type { WorldMonitoringEvent } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
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

/** Events this file adds with the service role, removed in afterAll. */
const addedEventIds: string[] = []

afterAll(async () => {
  if (addedEventIds.length) expectOk(await serviceRole().from('monitoring_events').delete().in('id', addedEventIds), 'remove added events')
})

/** The world's property manager straight against the Data API (PostgREST) with their own session, RLS applying. */
function managerDataApi() {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens.manager}` } },
  })
}

describe('monitoring event workflow in the database', () => {
  it('refuses a property manager who changes an event directly through the Data API, and changes nothing', async () => {
    for (const patch of [
      { status: 'dismissed', dismissal_reason: 'Skipping the API' },
      { description: 'Rewritten', calculation: { steps: [] } },
      { resolution_notes: null, dismissal_reason: null },
    ]) {
      const { error } = await managerDataApi().from('monitoring_events').update(patch).eq('id', event.id)
      expect(error?.code, JSON.stringify(patch)).toBe('42501')
    }
    expect(await snapshotRow('monitoring_events', event.id)).toEqual(original)
    expect(await auditCount(event.id)).toBe(auditBefore)
  })

  it('allows exactly the moves of the domain workflow (EVENT_TRANSITIONS)', async () => {
    const rows = await localSql(
      `select f::text as "from", t::text as "to", private.monitoring_event_transition_allowed(f, t) as allowed
       from unnest(enum_range(null::public.monitoring_event_status)) f cross join unnest(enum_range(null::public.monitoring_event_status)) t`,
    )
    const database = new Map((rows as { from: string; to: string; allowed: boolean }[]).map((row) => [`${row.from}>${row.to}`, row.allowed]))
    expect(database.size).toBe(MONITORING_EVENT_STATUSES.length ** 2)
    for (const from of MONITORING_EVENT_STATUSES) {
      for (const to of MONITORING_EVENT_STATUSES) expect(database.get(`${from}>${to}`), `${from} → ${to}`).toBe(canTransition(from, to))
    }
  })

  it('keeps a dismissed event dismissed, with its reason, through the API; the worker (service role) still writes', async () => {
    const a = world().companies.a
    const created = check(
      await serviceRole()
        .from('monitoring_events')
        .insert({
          company_id: a.id,
          type: 'statement_review_required',
          property_id: event.propertyId,
          title: `Integration ${integration().runId}: workflow`,
          description: 'Raised by the integration test.',
          identified_on: '2026-11-01',
          priority: 'low',
          recommended_action: 'Review.',
        })
        .select('id')
        .single(),
      'insert workflow event',
    ) as { id: string }
    addedEventIds.push(created.id)
    const path = '/api/v1/monitoring/events/{eventId}/status'
    const move = (body: { status: 'under_review' | 'dismissed' | 'resolved'; note?: string }) =>
      unwrap(apiAs('manager', 'a').PATCH(path, { params: { path: { eventId: created.id } }, body }))

    const dismissed = await move({ status: 'dismissed', note: 'Raised in error' })
    expect(dismissed).toMatchObject({ status: 'dismissed', dismissal: { reason: 'Raised in error', dismissedByUserId: world().users.manager.id } })
    expect(await auditCount(created.id)).toBe(1)

    for (const status of ['under_review', 'resolved'] as const) {
      const error = await apiErrorOf(move({ status }))
      expect(error.status).toBe(409)
      expect(error.message).toContain('An event cannot move from "dismissed"')
    }
    const after = await snapshotRow('monitoring_events', created.id)
    expect(after).toMatchObject({ status: 'dismissed', dismissal_reason: 'Raised in error' })
    expect(await auditCount(created.id)).toBe(1)

    // Background jobs write with the service role, which the workflow function does not replace.
    expectOk(await serviceRole().from('monitoring_events').update({ description: 'Updated by a job' }).eq('id', created.id), 'service role update')
    expect(await snapshotRow('monitoring_events', created.id)).toMatchObject({ description: 'Updated by a job', status: 'dismissed' })
  })
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
