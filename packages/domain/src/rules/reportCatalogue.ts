import { REPORT_IDS, type ReportDefinition, type ReportId } from '../types/reports.js'

/**
 * The reports LeaseGuard offers (PRD §7, §12.9), in display order: one entry per report id. Static metadata only;
 * every figure in a report is computed by the reports service from the company's verified records. Trends and
 * comparisons over time are future work (PRD §17.2) and are not listed.
 */
export const REPORT_CATALOGUE: readonly ReportDefinition[] = [
  { id: 'portfolio_overview', title: 'Portfolio overview', description: 'Properties, occupancy, rental roll and outstanding balances per property.', icon: 'building-2' },
  { id: 'occupancy', title: 'Occupancy', description: 'Occupied, vacant and under-offer units by property and unit type.', icon: 'door-open' },
  { id: 'lease_monitoring', title: 'Lease monitoring', description: 'Monitoring events by type, priority and status.', icon: 'activity' },
  { id: 'rental_discrepancies', title: 'Rental discrepancies', description: 'Billed rental versus escalated contractual rental on verified leases.', icon: 'trending-up' },
  { id: 'lease_expiry', title: 'Lease expiry', description: 'Verified leases by expiry: expired, within 3 months, 3–6 months, 6–12 months and later.', icon: 'calendar-clock' },
  { id: 'renewal_deadlines', title: 'Renewal deadlines', description: 'Renewal option notice deadlines on verified leases, soonest first, with the days left.', icon: 'calendar-check' },
  { id: 'deposits_guarantees', title: 'Deposits and guarantees', description: 'Security coverage, shortfalls and expiring bank guarantees.', icon: 'shield-check' },
  { id: 'arrears', title: 'Arrears ageing', description: 'Outstanding balances from verified statements, aged by bucket.', icon: 'wallet' },
  { id: 'payment_arrangements', title: 'Payment arrangements', description: 'Arrangement status, balance under arrangement and missed instalments.', icon: 'handshake' },
  { id: 'statement_processing', title: 'Statement processing', description: 'Statement statuses, extraction confidence and duplicates.', icon: 'file-text' },
  { id: 'communication_activity', title: 'Communication activity', description: 'WhatsApp messages by type and status, and approval turnaround.', icon: 'message-square' },
]

export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value)
}

/** The catalogue entry of a report id, or undefined for an unknown id. */
export function findReportDefinition(id: string): ReportDefinition | undefined {
  return isReportId(id) ? REPORT_CATALOGUE.find((definition) => definition.id === id) : undefined
}
