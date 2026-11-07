import { useMemo } from 'react'

import { nowISO } from '@/store/ids'
import { MONITORING_EVENT_TYPES, type EntityId, type MonitoringEvent, type MonitoringEventStatus, type MonitoringEventType, type MonitoringRule } from '@leaseguard/domain'

import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository, getCurrentUserId } from '@/services/repository'

export const eventsRepo = createRepository('monitoringEvents', {
  entityType: 'monitoring_event',
  label: 'Monitoring event',
  idPrefix: 'evt',
  searchFields: ['title', 'description', 'leaseReference'],
})

export const rulesRepo = createRepository('monitoringRules', {
  entityType: 'monitoring_rule',
  label: 'Monitoring rule',
  idPrefix: 'rule',
  searchFields: ['name', 'description'],
})

export const listEvents = eventsRepo.list
export const listAllEvents = eventsRepo.listAll
export const getEvent = eventsRepo.getById
export const createEvent = eventsRepo.create
export const listRules = rulesRepo.list
export const listAllRules = rulesRepo.listAll
export const getRule = rulesRepo.getById
export const createRule = rulesRepo.create
export const updateRule = rulesRepo.update

export const OPEN_EVENT_STATUSES: readonly MonitoringEventStatus[] = ['new', 'under_review', 'action_required', 'in_progress']
export const TERMINAL_EVENT_STATUSES: readonly MonitoringEventStatus[] = ['resolved', 'dismissed']

/** Forward workflow; `dismissed` is additionally reachable from any non-terminal status. */
export const EVENT_TRANSITIONS: Readonly<Record<MonitoringEventStatus, readonly MonitoringEventStatus[]>> = {
  new: ['under_review', 'dismissed'],
  under_review: ['action_required', 'dismissed'],
  action_required: ['in_progress', 'dismissed'],
  in_progress: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
}

export function canTransition(from: MonitoringEventStatus, to: MonitoringEventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to)
}

/**
 * Move an event along its workflow. Dismissing requires a reason (`notes`); resolving records
 * who resolved it and when.
 */
export function transitionEvent(eventId: EntityId, status: MonitoringEventStatus, notes?: string): MonitoringEvent {
  const event = eventsRepo.require(eventId)
  if (!canTransition(event.status, status)) {
    throw new Error(`Cannot move event from "${event.status}" to "${status}"`)
  }
  const actor = getCurrentUserId()
  const at = nowISO()

  if (status === 'dismissed') {
    const reason = notes?.trim()
    if (!reason) throw new Error('A reason is required to dismiss a monitoring event')
    return eventsRepo.update(
      eventId,
      { status, dismissal: { reason, dismissedByUserId: actor, dismissedAt: at } },
      { action: 'dismiss', summary: `Event dismissed: ${reason}` },
    )
  }

  if (status === 'resolved') {
    return eventsRepo.update(
      eventId,
      {
        status,
        resolvedAt: at,
        resolvedByUserId: actor,
        ...(notes !== undefined ? { resolutionNotes: notes } : {}),
      },
      { action: 'resolve', summary: notes ? `Event resolved: ${notes}` : 'Event resolved' },
    )
  }

  return eventsRepo.update(
    eventId,
    { status, ...(notes !== undefined ? { resolutionNotes: notes } : {}) },
    { summary: `Event moved to ${status.replace('_', ' ')}` },
  )
}

export function assignEvent(eventId: EntityId, userId: EntityId | undefined): MonitoringEvent {
  return eventsRepo.update(
    eventId,
    { assignedToUserId: userId },
    { summary: userId ? `Event assigned to ${userId}` : 'Event unassigned' },
  )
}

export function setRuleEnabled(ruleId: EntityId, enabled: boolean): MonitoringRule {
  return rulesRepo.update(ruleId, { enabled }, { summary: enabled ? 'Rule enabled' : 'Rule disabled' })
}

export type EventCountsByType = Readonly<Record<MonitoringEventType, number>>

export function countOpenEventsByType(events: readonly MonitoringEvent[]): EventCountsByType {
  const counts = Object.fromEntries(MONITORING_EVENT_TYPES.map((t) => [t, 0])) as Record<MonitoringEventType, number>
  for (const event of events) {
    if (OPEN_EVENT_STATUSES.includes(event.status)) counts[event.type] += 1
  }
  return counts
}

// Hooks --------------------------------------------------------------------

export function useEvents(query?: ListQuery<MonitoringEvent>): PagedResult<MonitoringEvent> {
  return eventsRepo.useList(query)
}

export const useAllEvents = eventsRepo.useAll
export const useEvent = eventsRepo.useById
export const useAllRules = rulesRepo.useAll
export const useRule = rulesRepo.useById

export function useOpenEvents(): MonitoringEvent[] {
  const all = eventsRepo.useAll()
  return useMemo(() => all.filter((e) => OPEN_EVENT_STATUSES.includes(e.status)), [all])
}

export function useOpenEventCounts(): EventCountsByType {
  const all = eventsRepo.useAll()
  return useMemo(() => countOpenEventsByType(all), [all])
}
