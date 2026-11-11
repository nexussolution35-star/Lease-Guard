import { isValidISODate } from '@leaseguard/domain'
import { z } from 'zod'

/** A calendar date in the address, or nothing when it is missing or not a date. */
const isoDate = z.string().refine(isValidISODate).optional().catch(undefined)

/**
 * `/communications/analytics` search params: the range's first and last South African day. Without them the API's
 * default (the last 30 days). The range itself is checked by the screen, which explains a range it cannot show.
 */
export const analyticsSearchSchema = z.object({ from: isoDate, to: isoDate })

export type AnalyticsSearch = z.output<typeof analyticsSearchSchema>
