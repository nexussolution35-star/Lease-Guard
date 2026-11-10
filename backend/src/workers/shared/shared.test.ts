import { describe, expect, it } from 'vitest'

import { fakeDb } from '../../common/testing/fake-db.test-helpers'
import { COMPANY, companySettingsRow, rule } from '../workers.test-helpers'
import { chunk, fetchAll, PAGE_SIZE } from './db'
import { MonitoringOutputs, toEventInsert } from './monitoring-outputs'
import { buildMonitoringSettings } from './monitoring-settings'

describe('fetchAll', () => {
  it('pages until a short page arrives', async () => {
    const pages = [Array.from({ length: PAGE_SIZE }, (_, i) => i), [PAGE_SIZE]]
    const ranges: [number, number][] = []
    const rows = await fetchAll('Load', async (from, to) => {
      ranges.push([from, to])
      return { data: pages[ranges.length - 1] ?? [], error: null }
    })
    expect(rows).toHaveLength(PAGE_SIZE + 1)
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ])
  })

  it('throws a retryable database error', async () => {
    await expect(fetchAll('Load leases', async () => ({ data: null, error: { code: '57014', message: 'timeout' } }))).rejects.toThrow(
      'Load leases failed (57014): timeout',
    )
  })

  it('chunks lists', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('buildMonitoringSettings', () => {
  it('uses company settings when no rule exists, and the rule when it does', () => {
    const none = buildMonitoringSettings(companySettingsRow, [])
    expect(none.rule('lease_expiry')).toEqual({ enabled: true })
    expect(none.company.leaseExpiryNoticeDays).toEqual([180, 90, 30])

    const configured = buildMonitoringSettings(companySettingsRow, [
      rule({ event_type: 'arrears', enabled: false, default_priority: 'high', config: { kind: 'arrears', minimumBalanceRands: 500, ageingBucketsDays: [30, 60] } }),
    ])
    expect(configured.rule('arrears')).toEqual({
      enabled: false,
      ruleId: 'rule-arrears',
      defaultPriority: 'high',
      config: { kind: 'arrears', minimumBalanceRands: 500, ageingBucketsDays: [30, 60] },
    })
  })

  it('keeps the rule switch but drops a config that does not parse', () => {
    const problems: string[] = []
    const result = buildMonitoringSettings(
      companySettingsRow,
      [rule({ event_type: 'lease_expiry', config: { kind: 'lease_expiry', noticeDays: 'ninety' } })],
      (type) => problems.push(type),
    )
    expect(result.rule('lease_expiry')).toEqual({ enabled: true, ruleId: 'rule-lease_expiry', defaultPriority: 'medium' })
    expect(problems).toEqual(['lease_expiry'])
  })
})

describe('toEventInsert', () => {
  it('takes company_id from the job and stores the calculation as JSON', () => {
    const row = toEventInsert(COMPANY, {
      dedupeKey: 'arrears:s1',
      type: 'arrears',
      propertyId: 'p1',
      title: 'T',
      description: 'D',
      identifiedOn: '2026-11-09',
      priority: 'high',
      recommendedAction: 'A',
      calculation: { actualAmount: 10, steps: ['one'] },
    })
    expect(row).toMatchObject({ company_id: COMPANY, dedupe_key: 'arrears:s1', calculation: { actualAmount: 10, steps: ['one'] }, unit_id: null, status: 'new' })
  })

  it('writes nothing for an empty scan', async () => {
    const db = fakeDb(() => ({ data: [], error: null }))
    await expect(new MonitoringOutputs(db.client, COMPANY).raise([], { notify: false })).resolves.toEqual({ created: 0, notified: 0 })
    expect(db.queries).toEqual([])
  })
})
