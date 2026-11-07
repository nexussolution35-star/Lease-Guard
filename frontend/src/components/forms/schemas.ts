import { z } from 'zod'
import { compareISODate, isValidISODate, roundZar } from '@leaseguard/domain'
import type { ISODate } from '@leaseguard/domain'

export { saPhoneNumberSchema } from './phone'

/** Non-negative rand amount with at most 2 decimal places. */
export const zarAmount = z
  .number({ error: 'Enter an amount' })
  .finite({ error: 'Enter an amount' })
  .nonnegative({ error: 'Amount cannot be negative' })
  .refine((value) => roundZar(value) === value, {
    message: 'Amount can have at most 2 decimal places',
  })

/** Percentage between 0 and 100 inclusive. */
export const percentage = z
  .number({ error: 'Enter a percentage' })
  .min(0, { error: 'Percentage cannot be below 0' })
  .max(100, { error: 'Percentage cannot exceed 100' })

/** Required calendar date `YYYY-MM-DD`. */
export const isoDate = z
  .string({ error: 'Select a date' })
  .refine((value): value is ISODate => isValidISODate(value), { message: 'Select a valid date' })

/** Optional calendar date; empty string is treated as not set. */
export const optionalIsoDate = z
  .union([z.literal('').transform(() => undefined), isoDate])
  .optional()

/** Trimmed, non-empty string with a "<label> is required" message. */
export function requiredString(label: string) {
  return z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, { error: `${label} is required` })
}

/** Optional e-mail address; empty string allowed. */
export const optionalEmail = z
  .union([z.literal(''), z.email({ error: 'Enter a valid e-mail address' })])
  .optional()

export interface DateRangeRefinementOptions<K extends string> {
  start: K
  end: K
  message?: string
}

/**
 * `superRefine` helper: the `end` date must be on or after the `start` date. Skips the check
 * when either date is missing or invalid (other rules report those). The issue is attached
 * to the `end` path.
 *
 * ```ts
 * schema.superRefine(dateRangeRefinement({ start: 'startDate', end: 'endDate' }))
 * ```
 */
export function dateRangeRefinement<K extends string>({
  start,
  end,
  message = 'End date must be on or after the start date',
}: DateRangeRefinementOptions<K>) {
  return (value: { [P in K]?: unknown }, ctx: z.RefinementCtx): void => {
    const startValue = value[start]
    const endValue = value[end]
    if (typeof startValue !== 'string' || typeof endValue !== 'string') return
    if (!isValidISODate(startValue) || !isValidISODate(endValue)) return
    if (compareISODate(endValue, startValue) < 0) {
      ctx.addIssue({ code: 'custom', message, path: [end] })
    }
  }
}
