import { ApiProperty } from '@nestjs/swagger'
import type { DashboardSummary } from '@leaseguard/domain'

const OPEN_EVENTS = 'Open monitoring events (new, under review, action required, in progress) of type'

/** Same shape as the domain `DashboardSummary`. */
export class DashboardSummaryDto implements DashboardSummary {
  @ApiProperty({ format: 'date', description: 'The South African calendar day the figures are as of (balances are aged to it)' })
  asOf!: string
  @ApiProperty({ minimum: 0, description: 'Properties that are not archived' }) properties!: number
  @ApiProperty({ minimum: 0, description: 'Units of the properties that are not archived' }) units!: number
  @ApiProperty({ minimum: 0, description: 'Of those units, the ones whose occupancy status is occupied' }) occupiedUnits!: number
  @ApiProperty({ minimum: 0, description: 'Leases with status active' }) activeLeases!: number
  @ApiProperty({
    minimum: 0,
    description: "Rands (ZAR), 2 decimals; the outstanding balance on each unit's latest verified statement, totalled (as GET /statements/arrears)",
  })
  totalOutstanding!: number
  @ApiProperty({ minimum: 0, description: 'Distinct tenants with an outstanding balance on a latest verified statement' }) tenantsInArrears!: number
  @ApiProperty({ minimum: 0, description: 'Payment arrangements with status active (monitoring records, never payments)' })
  activeArrangements!: number
  @ApiProperty({ minimum: 0, description: `${OPEN_EVENTS} rental_escalation_discrepancy` }) escalationDiscrepancies!: number
  @ApiProperty({ minimum: 0, description: `${OPEN_EVENTS} lease_expiry` }) upcomingExpiries!: number
  @ApiProperty({ minimum: 0, description: `${OPEN_EVENTS} renewal_notice_deadline` }) renewalDeadlines!: number
  @ApiProperty({ minimum: 0, description: `${OPEN_EVENTS} guarantee_expiry` }) expiringGuarantees!: number
  @ApiProperty({ minimum: 0, description: 'Statements waiting for review (review_required)' }) pendingStatementReviews!: number
  @ApiProperty({ minimum: 0, description: "Tenant messages waiting on a property manager's approval" }) pendingApprovals!: number
}
