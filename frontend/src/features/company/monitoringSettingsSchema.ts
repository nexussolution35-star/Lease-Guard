import { WEEKDAYS } from '@leaseguard/domain'
import { z } from 'zod'

import type { CompanyChanges, CompanyProfile } from './api/source'

type CompanySettings = CompanyProfile['settings']

const MAX_NOTICE_DAYS = 3650
const MAX_NOTICES = 10

/**
 * Notice days typed as a list ("180, 90, 30"): whole days from 1 to 3650, each once, at most ten, as
 * the API requires. Returned longest notice first; a string says what is wrong.
 */
export function parseNoticeDays(text: string): number[] | string {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== '')
  if (parts.length === 0) return 'Enter at least one number of days, e.g. 90, 60, 30'
  if (parts.length > MAX_NOTICES) return `Enter at most ${MAX_NOTICES} notice periods`
  const days: number[] = []
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) return `"${part}" is not a whole number of days`
    const value = Number(part)
    if (value < 1 || value > MAX_NOTICE_DAYS) return `Each notice must be between 1 and ${MAX_NOTICE_DAYS} days`
    if (days.includes(value)) return `${value} days is listed more than once`
    days.push(value)
  }
  return days.sort((a, b) => b - a)
}

/** Notice days as the form shows them: longest notice first, comma-separated. */
export function formatNoticeDays(days: readonly number[]): string {
  return [...days].sort((a, b) => b - a).join(', ')
}

/** Kept as typed text in the form (see `parseNoticeDays`); `monitoringSettingsChangesFrom` reads the days. */
const noticeDays = z.string().superRefine((text, ctx) => {
  const parsed = parseNoticeDays(text)
  if (typeof parsed === 'string') ctx.addIssue({ code: 'custom', message: parsed })
})

const wholeDays = (max: number) =>
  z
    .number({ error: 'Enter a number of days' })
    .int('Enter whole days')
    .min(0, 'Days cannot be negative')
    .max(max, `Use at most ${max} days`)

export const REMINDER_ORDER_ERROR = 'Reminders must go out in order: initial, then overdue, then follow-up (each later than the one before).'

/** The monitoring and reminder settings form (`PATCH /companies/{id}` `settings`), with the API's own rules. */
export const monitoringSettingsFormSchema = z
  .object({
    leaseExpiryNoticeDays: noticeDays,
    renewalDeadlineWarningDays: noticeDays,
    guaranteeExpiryNoticeDays: noticeDays,
    initial: wholeDays(365),
    overdue: wholeDays(365),
    followUp: wholeDays(365),
    installmentReminderLeadDays: wholeDays(60),
    ownerSummaryWeekday: z.enum(WEEKDAYS, { error: 'Choose a day' }),
  })
  .superRefine((values, ctx) => {
    if (!(values.initial < values.overdue)) ctx.addIssue({ code: 'custom', path: ['overdue'], message: REMINDER_ORDER_ERROR })
    else if (!(values.overdue < values.followUp)) ctx.addIssue({ code: 'custom', path: ['followUp'], message: REMINDER_ORDER_ERROR })
  })

export type MonitoringSettingsFormValues = z.output<typeof monitoringSettingsFormSchema>

export function monitoringSettingsFormDefaults(settings: CompanySettings): MonitoringSettingsFormValues {
  return {
    leaseExpiryNoticeDays: formatNoticeDays(settings.leaseExpiryNoticeDays),
    renewalDeadlineWarningDays: formatNoticeDays(settings.renewalDeadlineWarningDays),
    guaranteeExpiryNoticeDays: formatNoticeDays(settings.guaranteeExpiryNoticeDays),
    initial: settings.paymentReminderOffsetsDays.initial,
    overdue: settings.paymentReminderOffsetsDays.overdue,
    followUp: settings.paymentReminderOffsetsDays.followUp,
    installmentReminderLeadDays: settings.installmentReminderLeadDays,
    ownerSummaryWeekday: settings.ownerSummaryWeekday,
  }
}

const sameDays = (a: readonly number[], b: readonly number[]) => formatNoticeDays(a) === formatNoticeDays(b)

/**
 * The `PATCH /companies/{id}` body for the settings that differ from the saved ones, or null when
 * nothing changed. The three reminder offsets travel together, as the API validates them together.
 */
export function monitoringSettingsChangesFrom(values: MonitoringSettingsFormValues, saved: CompanySettings): CompanyChanges | null {
  const settings: NonNullable<CompanyChanges['settings']> = {}
  for (const field of ['leaseExpiryNoticeDays', 'renewalDeadlineWarningDays', 'guaranteeExpiryNoticeDays'] as const) {
    const days = parseNoticeDays(values[field])
    // The schema has already refused text that is not a list of days.
    if (typeof days !== 'string' && !sameDays(days, saved[field])) settings[field] = days
  }
  const offsets = saved.paymentReminderOffsetsDays
  if (values.initial !== offsets.initial || values.overdue !== offsets.overdue || values.followUp !== offsets.followUp) {
    settings.paymentReminderOffsetsDays = { initial: values.initial, overdue: values.overdue, followUp: values.followUp }
  }
  if (values.installmentReminderLeadDays !== saved.installmentReminderLeadDays) settings.installmentReminderLeadDays = values.installmentReminderLeadDays
  if (values.ownerSummaryWeekday !== saved.ownerSummaryWeekday) settings.ownerSummaryWeekday = values.ownerSummaryWeekday
  return Object.keys(settings).length > 0 ? { settings } : null
}
