import { describe, expect, it } from 'vitest'

import type { CompanyProfile } from './api/source'
import {
  formatNoticeDays,
  monitoringSettingsChangesFrom,
  monitoringSettingsFormDefaults,
  monitoringSettingsFormSchema,
  parseNoticeDays,
  REMINDER_ORDER_ERROR,
} from './monitoringSettingsSchema'

const SETTINGS: CompanyProfile['settings'] = {
  leaseExpiryNoticeDays: [30, 180, 90],
  renewalDeadlineWarningDays: [90, 30],
  guaranteeExpiryNoticeDays: [60, 30],
  paymentReminderOffsetsDays: { initial: 7, overdue: 14, followUp: 21 },
  installmentReminderLeadDays: 3,
  ownerSummaryWeekday: 'monday',
  timezone: 'Africa/Johannesburg',
}

const parse = (overrides: Record<string, unknown> = {}) => monitoringSettingsFormSchema.parse({ ...monitoringSettingsFormDefaults(SETTINGS), ...overrides })

describe('parseNoticeDays', () => {
  it('reads a list in any order, longest notice first', () => {
    expect(parseNoticeDays('30, 180 90')).toEqual([180, 90, 30])
    expect(formatNoticeDays([30, 180, 90])).toBe('180, 90, 30')
  })

  it.each([
    ['', 'Enter at least one number of days, e.g. 90, 60, 30'],
    ['90, sixty', '"sixty" is not a whole number of days'],
    ['90, 7.5', '"7.5" is not a whole number of days'],
    ['90, 0', 'Each notice must be between 1 and 3650 days'],
    ['90, 30, 90', '90 days is listed more than once'],
    ['1,2,3,4,5,6,7,8,9,10,11', 'Enter at most 10 notice periods'],
  ])('refuses "%s"', (text, message) => {
    expect(parseNoticeDays(text)).toBe(message)
  })
})

describe('monitoringSettingsFormSchema', () => {
  it('accepts the saved settings, showing the longest notice first', () => {
    expect(parse().leaseExpiryNoticeDays).toBe('180, 90, 30')
  })

  it.each([
    [{ initial: 14 }, 'overdue'],
    [{ followUp: 14 }, 'followUp'],
  ])('requires the reminders to increase (%o)', (overrides, path) => {
    const result = monitoringSettingsFormSchema.safeParse({ ...monitoringSettingsFormDefaults(SETTINGS), ...overrides })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({ path: [path], message: REMINDER_ORDER_ERROR })
  })

  it('limits the instalment reminder to 60 days', () => {
    expect(monitoringSettingsFormSchema.safeParse({ ...monitoringSettingsFormDefaults(SETTINGS), installmentReminderLeadDays: 61 }).success).toBe(false)
  })
})

describe('monitoringSettingsChangesFrom', () => {
  it('is null when nothing changed, whatever the order of the saved days', () => {
    expect(monitoringSettingsChangesFrom(parse(), SETTINGS)).toBeNull()
  })

  it('sends only the settings that changed, with the three reminder offsets together', () => {
    expect(monitoringSettingsChangesFrom(parse({ leaseExpiryNoticeDays: '365, 180', overdue: 15, ownerSummaryWeekday: 'friday' }), SETTINGS)).toEqual({
      settings: {
        leaseExpiryNoticeDays: [365, 180],
        paymentReminderOffsetsDays: { initial: 7, overdue: 15, followUp: 21 },
        ownerSummaryWeekday: 'friday',
      },
    })
  })
})
