import { REPORT_IDS, type ReportDefinition, type ReportId } from '@leaseguard/domain'

/** The reports LeaseGuard offers (static metadata). */
export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  { id: 'portfolio_overview', title: 'Portfolio overview', description: 'Properties, occupancy, rental roll and outstanding balances per property.', icon: 'building-2' },
  { id: 'occupancy', title: 'Occupancy', description: 'Occupied, vacant and under-offer units by property and unit type.', icon: 'door-open' },
  { id: 'lease_monitoring', title: 'Lease monitoring', description: 'Monitoring events by type, priority and status.', icon: 'activity' },
  { id: 'rental_discrepancies', title: 'Rental discrepancies', description: 'Billed rental versus escalated contractual rental on verified leases.', icon: 'trending-up' },
  { id: 'lease_expiry', title: 'Lease expiry', description: 'Leases expiring in 0–30, 31–90, 91–180, 181–365 and 365+ days.', icon: 'calendar-clock' },
  { id: 'renewal_deadlines', title: 'Renewal deadlines', description: 'Renewal option notice deadlines and their urgency.', icon: 'calendar-check' },
  { id: 'deposits_guarantees', title: 'Deposits and guarantees', description: 'Security coverage, shortfalls and expiring bank guarantees.', icon: 'shield-check' },
  { id: 'arrears', title: 'Arrears ageing', description: 'Outstanding balances from verified statements, aged by bucket.', icon: 'wallet' },
  { id: 'payment_arrangements', title: 'Payment arrangements', description: 'Arrangement status, balance under arrangement and missed instalments.', icon: 'handshake' },
  { id: 'statement_processing', title: 'Statement processing', description: 'Statement statuses, extraction confidence and duplicates.', icon: 'file-text' },
  { id: 'communication_activity', title: 'Communication activity', description: 'WhatsApp messages by type and status, and approval turnaround.', icon: 'message-square' },
]

export function getReportDefinition(id: ReportId): ReportDefinition {
  const def = REPORT_DEFINITIONS.find((d) => d.id === id)
  if (!def) throw new Error(`Unknown report ${id}`)
  return def
}

export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value)
}

/** The definition for a route parameter, or undefined for unknown report ids. */
export function findReportDefinition(id: string): ReportDefinition | undefined {
  return isReportId(id) ? REPORT_DEFINITIONS.find((d) => d.id === id) : undefined
}
