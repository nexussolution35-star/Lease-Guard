import type { ISODate } from '@leaseguard/domain'

/** LeaseGuard operates in South Africa only (companies.timezone is constrained to this zone). */
const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * The calendar date in South Africa at `now`, as `YYYY-MM-DD`, independent of the host's time zone: the date every
 * report is "as at", the same "today" the core service and its worker use (backend/src/common/sa-today.ts).
 */
export function saToday(now: Date): ISODate {
  const parts = SA_DATE.formatToParts(now)
  const part = (type: 'year' | 'month' | 'day'): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
