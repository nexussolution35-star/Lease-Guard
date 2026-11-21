import { describe, expect, it } from 'vitest'

import { dueWindowRange, MONITORING_DUE_WINDOWS } from './monitoringList.js'

describe('dueWindowRange', () => {
  it('reads overdue as due before today, with no lower bound', () => {
    expect(dueWindowRange('overdue', '2026-11-21')).toEqual({ to: '2026-11-20' })
  })

  it('reads the next n days as today to n days from today, inclusive', () => {
    expect(dueWindowRange('next_7_days', '2026-11-21')).toEqual({ from: '2026-11-21', to: '2026-11-28' })
    expect(dueWindowRange('next_30_days', '2026-11-21')).toEqual({ from: '2026-11-21', to: '2026-12-21' })
    expect(dueWindowRange('next_90_days', '2026-12-31')).toEqual({ from: '2026-12-31', to: '2027-03-31' })
  })

  it('crosses month and leap-day boundaries by calendar day', () => {
    expect(dueWindowRange('overdue', '2028-03-01')).toEqual({ to: '2028-02-29' })
    expect(dueWindowRange('next_7_days', '2028-02-25')).toEqual({ from: '2028-02-25', to: '2028-03-03' })
  })

  it('has a range for every window', () => {
    for (const window of MONITORING_DUE_WINDOWS) expect(dueWindowRange(window, '2026-11-21').to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
