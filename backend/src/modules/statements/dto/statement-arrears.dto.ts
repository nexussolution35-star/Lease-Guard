import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { AgeingBucketLabel, ArrearsOverviewBucket, StatementArrearsEntry, StatementArrearsSummary } from '@leaseguard/domain'

const ZAR = 'Rands (ZAR), 2 decimals'
const BUCKET = "Ageing bucket: 'current', then one label per boundary in days ('30', '60', …); the last is open-ended ('120+')"

/** Same shape as the domain `ArrearsOverviewBucket`. */
export class ArrearsBucketDto implements ArrearsOverviewBucket {
  @ApiProperty({ type: String, description: BUCKET, example: '30' }) bucket!: AgeingBucketLabel
  @ApiProperty({ description: 'The days the bucket covers, in words', example: '30–59 days' }) description!: string
  @ApiProperty({ description: `${ZAR}; the outstanding balances aged into this bucket`, minimum: 0 }) outstanding!: number
  @ApiProperty({ minimum: 0, description: 'Distinct tenants with a balance in this bucket' }) tenantCount!: number
}

/** Same shape as the domain `StatementArrearsEntry`. */
export class StatementArrearsEntryDto implements StatementArrearsEntry {
  @ApiProperty({ format: 'uuid' }) tenantId!: string
  @ApiProperty() tenantName!: string
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiProperty() propertyName!: string
  @ApiPropertyOptional({ format: 'uuid' }) unitId?: string
  @ApiPropertyOptional() unitNumber?: string
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string
  @ApiProperty({ format: 'uuid', description: "The latest verified statement of the tenant's lease, which the balance comes from" }) statementId!: string
  @ApiProperty({ format: 'date' }) statementDate!: string
  @ApiProperty({ description: `${ZAR}; the closing balance (or total due) of that statement, always above zero` }) outstanding!: number
  @ApiProperty({ minimum: 0, description: 'Days from the statement date to asOf' }) ageDays!: number
  @ApiProperty({ type: String, description: BUCKET }) bucket!: AgeingBucketLabel
  @ApiProperty({ description: 'An active payment arrangement is in force for the tenant' }) underArrangement!: boolean
  @ApiProperty({ description: "That arrangement pauses the tenant's normal arrears reminders" }) remindersSuppressed!: boolean
  @ApiPropertyOptional({ format: 'uuid', description: 'Who verified the statement' }) verifiedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) verifiedAt?: string
}

/** Same shape as the domain `StatementArrearsSummary`. */
export class StatementArrearsSummaryDto implements StatementArrearsSummary {
  @ApiProperty({ format: 'date', description: 'The South African calendar day balances are aged to (today)' }) asOf!: string
  @ApiProperty({ type: [Number], description: "Bucket boundaries in days, from the company's arrears monitoring rule" }) ageingBuckets!: number[]
  @ApiProperty({ description: `${ZAR}; the sum of every entry: each tenant's outstanding balance on every lease`, minimum: 0 }) totalOutstanding!: number
  @ApiProperty({ minimum: 0, description: 'Distinct tenants in arrears, on one lease or more' }) tenantsInArrears!: number
  @ApiProperty({ minimum: 0, description: 'Tenants in arrears with an active payment arrangement' }) tenantsUnderArrangement!: number
  @ApiProperty({ minimum: 0, description: 'Statements waiting for review (review_required); they are not counted above' }) pendingReview!: number
  @ApiProperty({ type: [ArrearsBucketDto], description: 'Every bucket of the configuration, in ageing order' }) buckets!: ArrearsBucketDto[]
  @ApiProperty({
    type: [StatementArrearsEntryDto],
    description: 'One entry per tenant and lease in arrears (a tenant with several leases has several), largest balance first',
  })
  entries!: StatementArrearsEntryDto[]
}
