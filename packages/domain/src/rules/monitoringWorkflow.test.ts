import { describe, expect, it } from 'vitest'

import { MONITORING_EVENT_STATUSES } from '../types/index.js'
import {
  arrearsEventPriority,
  canTransition,
  EVENT_TRANSITIONS,
  isOpenEventStatus,
  leaseStatusAfterVerification,
  OPEN_EVENT_STATUSES,
  TERMINAL_EVENT_STATUSES,
} from './monitoringWorkflow.js'

describe('monitoring event workflow', () => {
  it('partitions every status into open or terminal', () => {
    expect([...OPEN_EVENT_STATUSES, ...TERMINAL_EVENT_STATUSES].sort()).toEqual([...MONITORING_EVENT_STATUSES].sort())
    expect(isOpenEventStatus('in_progress')).toBe(true)
    expect(isOpenEventStatus('resolved')).toBe(false)
  })

  it('moves forward one step at a time and can always be dismissed while open', () => {
    expect(canTransition('new', 'under_review')).toBe(true)
    expect(canTransition('new', 'resolved')).toBe(false)
    expect(canTransition('in_progress', 'resolved')).toBe(true)
    for (const status of OPEN_EVENT_STATUSES) expect(canTransition(status, 'dismissed')).toBe(true)
  })

  it('never leaves a terminal status and never returns to new', () => {
    for (const status of TERMINAL_EVENT_STATUSES) expect(EVENT_TRANSITIONS[status]).toEqual([])
    for (const status of MONITORING_EVENT_STATUSES) expect(canTransition(status, 'new')).toBe(false)
    expect(canTransition('dismissed', 'resolved')).toBe(false)
  })
})

describe('arrearsEventPriority', () => {
  const buckets = [30, 60, 90, 120]
  it('uses the default for current balances, high for older buckets and critical for the oldest', () => {
    expect(arrearsEventPriority('current', buckets, 'medium')).toBe('medium')
    expect(arrearsEventPriority('30', buckets, 'medium')).toBe('high')
    expect(arrearsEventPriority('90', buckets, 'low')).toBe('high')
    expect(arrearsEventPriority('120+', buckets, 'medium')).toBe('critical')
  })

  it('falls back to the default bucket configuration', () => {
    expect(arrearsEventPriority('120+', undefined, 'medium')).toBe('critical')
    expect(arrearsEventPriority('45', buckets, 'low')).toBe('low')
  })
})

describe('leaseStatusAfterVerification', () => {
  it('activates draft and pending leases and keeps every other status', () => {
    expect(leaseStatusAfterVerification('draft')).toBe('active')
    expect(leaseStatusAfterVerification('pending_verification')).toBe('active')
    for (const status of ['active', 'expiring', 'expired', 'renewed', 'terminated'] as const) {
      expect(leaseStatusAfterVerification(status)).toBe(status)
    }
  })
})
