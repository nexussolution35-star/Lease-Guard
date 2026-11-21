import { buildOwnerWeeklySummary, ownerSummaryTemplateValues, type OwnerSummaryDeliveryJob } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import type { CompanyOwnerSummaries, ComputedOwnerSummary } from '../reports/owner-summary.service'
import {
  companyOwnerSummaryJobId,
  dispatchOwnerSummaries,
  runCompanyOwnerSummaries,
  type CompanyOwnerSummaryJob,
  type OwnerSummaryRecord,
  type OwnerSummaryStore,
} from './owner-summary-run'

const COMPANY = 'c1'
const MONDAY = '2026-11-23'

function owner(userId: string, blockers: string[] = []): ComputedOwnerSummary {
  const summary = buildOwnerWeeklySummary({
    owner: { userId, name: `Owner ${userId}` },
    properties: [{ propertyId: 'p1', propertyName: 'Maponya Square' }],
    asOf: MONDAY,
    sources: { accounts: [], arrangements: [], events: [], rentalComparisons: [], security: [], guaranteeNoticeDays: [] },
  })
  return {
    owner: { userId, name: `Owner ${userId}`, status: 'active', role: 'property_owner', whatsappNumber: '+27820000001', properties: summary.properties },
    summary,
    values: ownerSummaryTemplateValues(summary),
    blockers,
  }
}

function company(owners: ComputedOwnerSummary[]): CompanyOwnerSummaries {
  return { asOf: MONDAY, weekStart: MONDAY, weekday: 'monday', companyBlockers: [], owners, stored: [] }
}

function memoryStore(existing: Record<string, 'ready' | 'blocked' | 'handed_over'> = {}) {
  const rows = new Map<string, { summaryId: string; status: 'ready' | 'blocked' | 'handed_over'; record?: OwnerSummaryRecord }>(
    Object.entries(existing).map(([ownerId, status]) => [ownerId, { summaryId: `s-${ownerId}`, status }]),
  )
  const store: OwnerSummaryStore = {
    companies: async () => [
      { companyId: 'c-monday', weekday: 'monday' },
      { companyId: 'c-friday', weekday: 'friday' },
    ],
    find: async (_companyId, ownerUserId) => {
      const row = rows.get(ownerUserId)
      return row ? { summaryId: row.summaryId, status: row.status } : null
    },
    save: async (record) => {
      const summaryId = rows.get(record.ownerUserId)?.summaryId ?? `s-${record.ownerUserId}`
      rows.set(record.ownerUserId, { summaryId, status: record.status, record })
      return summaryId
    },
    markHandedOver: async (_companyId, summaryId) => {
      for (const row of rows.values()) if (row.summaryId === summaryId) row.status = 'handed_over'
    },
  }
  return { store, rows }
}

describe('dispatchOwnerSummaries', () => {
  it('queues the companies whose owner summary day is today, once per company and week', async () => {
    const jobs: CompanyOwnerSummaryJob[] = []
    const { store } = memoryStore()
    await expect(dispatchOwnerSummaries({ store, enqueue: async (batch) => void jobs.push(...batch) }, MONDAY)).resolves.toEqual({
      asOf: MONDAY,
      companies: ['c-monday'],
    })
    expect(jobs).toEqual([{ companyId: 'c-monday', asOf: MONDAY }])
    expect(companyOwnerSummaryJobId({ companyId: 'C1', asOf: '2026-11-25' })).toBe('reports-owner-summary.c1.2026-11-23')
  })
})

describe('runCompanyOwnerSummaries', () => {
  const run = (summaries: CompanyOwnerSummaries, store: OwnerSummaryStore) => {
    const requested: OwnerSummaryDeliveryJob[] = []
    const result = runCompanyOwnerSummaries(
      { compute: async () => summaries, store, delivery: { request: async (job) => void requested.push(job) } },
      { companyId: COMPANY, asOf: MONDAY },
    )
    return { result, requested }
  }

  it('stores every owner’s summary and hands the sendable ones to the core messaging pipeline', async () => {
    const { store, rows } = memoryStore()
    const { result, requested } = run(company([owner('o1'), owner('o2', ['No WhatsApp number is connected'])]), store)
    await expect(result).resolves.toEqual({ companyId: COMPANY, weekStart: MONDAY, handedOver: 1, blocked: 1, alreadyHandedOver: 0 })
    expect(requested).toEqual([{ companyId: COMPANY, summaryId: 's-o1' }])
    expect(rows.get('o1')?.status).toBe('handed_over')
    expect(rows.get('o2')).toMatchObject({ status: 'blocked', record: { blockers: ['No WhatsApp number is connected'] } })
    expect(rows.get('o1')?.record).toMatchObject({ weekStart: MONDAY, values: ['Owner o1', '23 Nov 2026', expect.stringContaining('Outstanding R 0,00')] })
  })

  it('never hands a summary over twice in a week, and finishes one a stopped run stored', async () => {
    const { store, rows } = memoryStore({ o1: 'handed_over', o2: 'ready' })
    const { result, requested } = run(company([owner('o1'), owner('o2')]), store)
    await expect(result).resolves.toMatchObject({ handedOver: 1, alreadyHandedOver: 1 })
    expect(requested).toEqual([{ companyId: COMPANY, summaryId: 's-o2' }])
    // The ready one is handed over as stored, not computed again.
    expect(rows.get('o2')?.record).toBeUndefined()
  })

  it('computes a blocked summary again, so a template approved later in the week lets it be sent', async () => {
    const { store, rows } = memoryStore({ o1: 'blocked' })
    const { result, requested } = run(company([owner('o1')]), store)
    await expect(result).resolves.toMatchObject({ handedOver: 1, blocked: 0 })
    expect(requested).toHaveLength(1)
    expect(rows.get('o1')?.status).toBe('handed_over')
  })
})
