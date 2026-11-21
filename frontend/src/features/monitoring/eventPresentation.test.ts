import { nextEventStatuses } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import type { AuditLogEntry } from '@/features/audit/api/source'

import { calculationLabels, historyEntryFrom, orderedActions } from './eventPresentation'

const log = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'a1',
  companyId: 'c1',
  action: 'update',
  entityType: 'monitoring_event',
  entityId: 'e1',
  summary: 'Monitoring event "Rental under-charged" new → under_review',
  occurredAt: '2026-11-03T10:00:00+02:00',
  createdAt: '2026-11-03T10:00:00+02:00',
  updatedAt: '2026-11-03T10:00:00+02:00',
  ...overrides,
})

describe('orderedActions', () => {
  it('puts dismissing first and the forward step last for every open status', () => {
    expect(orderedActions(nextEventStatuses('new'))).toEqual(['dismissed', 'under_review'])
    expect(orderedActions(nextEventStatuses('in_progress'))).toEqual(['dismissed', 'resolved'])
    expect(orderedActions(nextEventStatuses('resolved'))).toEqual([])
  })
})

describe('calculationLabels', () => {
  it('names the figures for what each rule compares', () => {
    expect(calculationLabels('rental_escalation_discrepancy')).toEqual({ expected: 'Expected rental', actual: 'Billed rental', difference: 'Difference' })
    expect(calculationLabels('guarantee_shortfall').difference).toBe('Shortfall')
    expect(calculationLabels('lease_expiry')).toEqual({ expected: 'Expected', actual: 'Actual', difference: 'Difference' })
  })
})

describe('historyEntryFrom', () => {
  it('reads a status change in words with the note given and the actor', () => {
    const entry = historyEntryFrom(
      log({ changes: [{ field: 'status', before: 'new', after: 'under_review' }, { field: 'resolution_notes', before: null, after: 'Checked the ledger' }] }),
      'Naledi van der Merwe',
    )
    expect(entry).toMatchObject({ title: 'New → Under review', description: 'Checked the ledger', actor: 'Naledi van der Merwe', tone: 'neutral' })
  })

  it("falls back to the summary for a dismissal recorded before notes went with the move, and leaves a job's actor out", () => {
    const entry = historyEntryFrom(
      log({ action: 'dismiss', summary: 'Dismissed monitoring event "x": Duplicate', changes: [{ field: 'status', before: 'new', after: 'dismissed' }] }),
      undefined,
    )
    expect(entry.title).toBe('New → Dismissed')
    expect(entry.description).toBe('Dismissed monitoring event "x": Duplicate')
    expect(entry).not.toHaveProperty('actor')
  })

  it('marks a resolution as settled', () => {
    expect(historyEntryFrom(log({ action: 'resolve', changes: [{ field: 'status', before: 'in_progress', after: 'resolved' }] }), undefined).tone).toBe('success')
  })
})
