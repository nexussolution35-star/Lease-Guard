import { describe, expect, it } from 'vitest'

import type { LeaseStatus } from '../types/index.js'
import { currentLease } from './currentLease.js'

const lease = (id: string, status: LeaseStatus, commencementDate = '2025-01-01') => ({ id, status, commencementDate })

describe('currentLease', () => {
  it('is undefined without leases', () => {
    expect(currentLease([])).toBeUndefined()
  })

  it('prefers a lease in force over one being set up, and that over one that ended', () => {
    expect(currentLease([lease('a', 'draft'), lease('b', 'active'), lease('c', 'expired')])?.id).toBe('b')
    expect(currentLease([lease('a', 'expired'), lease('b', 'pending_verification')])?.id).toBe('b')
    expect(currentLease([lease('a', 'terminated'), lease('b', 'renewed')])?.id).toBe('b')
    expect(currentLease([lease('a', 'expiring'), lease('b', 'draft')])?.id).toBe('a')
  })

  it('takes the latest commencement among equal statuses, then the lowest id', () => {
    expect(currentLease([lease('a', 'active', '2024-03-01'), lease('b', 'active', '2025-03-01')])?.id).toBe('b')
    expect(currentLease([lease('b', 'draft'), lease('a', 'draft')])?.id).toBe('a')
  })

  it('does not reorder the input', () => {
    const leases = [lease('a', 'draft'), lease('b', 'active')]
    currentLease(leases)
    expect(leases.map((l) => l.id)).toEqual(['a', 'b'])
  })
})
