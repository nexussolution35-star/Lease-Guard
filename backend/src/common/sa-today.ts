import type { ISODate } from '@leaseguard/domain'

/** LeaseGuard operates in South Africa only (companies.timezone is constrained to this zone). */
export const SA_TIME_ZONE = 'Africa/Johannesburg'

const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: SA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * The calendar date in South Africa at `now`, as `YYYY-MM-DD`, independent of the host's time zone.
 * The one "today" of the API and the worker, so approval and delivery judge a message on the same date.
 */
export function saToday(now: Date): ISODate {
  const parts = SA_DATE.formatToParts(now)
  const part = (type: 'year' | 'month' | 'day'): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
