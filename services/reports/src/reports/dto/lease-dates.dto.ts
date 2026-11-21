import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  EXPIRY_BUCKETS,
  RENEWAL_DEADLINE_ROW_STATUSES,
  type ExpiryBucket,
  type LeaseExpiryReport,
  type LeaseExpiryRow,
  type RenewalDeadlineRow,
  type RenewalDeadlineRowStatus,
  type RenewalDeadlinesReport,
} from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

// ------------------------------------------------------------------------------------------ lease expiry

export class LeaseExpiryRowDto implements LeaseExpiryRow {
  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty({ example: 'MSQ-L012' })
  reference!: string

  @ApiProperty({ format: 'uuid' })
  tenantId!: string

  @ApiProperty({ example: 'Dlamini Cellular' })
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty({ example: 'Maponya Square' })
  propertyName!: string

  @ApiProperty({ format: 'uuid' })
  unitId!: string

  @ApiProperty({ example: 'S01' })
  unitNumber!: string

  @ApiProperty({ format: 'date' })
  expiryDate!: string

  @ApiProperty({ description: 'Signed calendar days from the as-at date to expiry; negative once expired.' })
  daysUntilExpiry!: number

  @ApiProperty({
    enum: EXPIRY_BUCKETS,
    enumName: 'ExpiryBucket',
    description: 'Where the expiry falls in calendar months from the as-at date: expired, within 3 months, 3–6, 6–12, later.',
  })
  bucket!: ExpiryBucket

  @ApiProperty({ description: 'Current contractual monthly rental of the verified lease (ZAR, excl. VAT).' })
  monthlyRental!: number

  @ApiProperty({ description: 'The lease has a renewal option the tenant has not exercised.' })
  renewalOptionAvailable!: boolean

  @ApiPropertyOptional({ description: 'The company lease-expiry notice threshold (days) reached: the one monitoring raises its expiry event for.' })
  noticeThreshold?: number

  @ApiPropertyOptional({ format: 'uuid', description: 'The open lease-expiry monitoring event of the lease.' })
  openEventId?: string
}

export class ExpiryBucketTotalDto {
  @ApiProperty({ enum: EXPIRY_BUCKETS, enumName: 'ExpiryBucket' })
  bucket!: ExpiryBucket

  @ApiProperty()
  count!: number

  @ApiProperty({ description: 'Monthly rental of the leases in the bucket (ZAR, excl. VAT).' })
  monthlyRental!: number
}

export class LeaseExpiryReportDto implements LeaseExpiryReport {
  @ApiProperty({ type: [ExpiryBucketTotalDto], description: 'Every bucket, in order, with the leases shown in it.' })
  buckets!: ExpiryBucketTotalDto[]

  @ApiProperty({ type: [LeaseExpiryRowDto], description: 'Verified leases in a monitored status (active, expiring), soonest expiry first.' })
  rows!: LeaseExpiryRowDto[]

  @ApiProperty({ description: 'Leases shown whose expiry date has passed.' })
  expiredCount!: number

  @ApiProperty({ description: 'Leases shown inside a company notice threshold: the leases monitoring raises an expiry event for.' })
  withinNoticeCount!: number

  @ApiProperty({ type: [Number], description: 'The company lease-expiry notice thresholds in days, largest first; empty when the rule is off.' })
  noticeDays!: number[]

  @ApiProperty({ description: 'Leases that have not ended whose terms are not verified: not monitored, so not listed.' })
  unverifiedLeasesExcluded!: number
}

export class LeaseExpiryResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['lease_expiry'] })
  reportId!: 'lease_expiry'

  @ApiProperty({ type: LeaseExpiryReportDto })
  data!: LeaseExpiryReportDto
}

// ------------------------------------------------------------------------------------------ renewal deadlines

export class RenewalDeadlineRowDto implements RenewalDeadlineRow {
  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty({ example: 'MSQ-L012' })
  reference!: string

  @ApiProperty({ format: 'uuid' })
  tenantId!: string

  @ApiProperty({ example: 'Dlamini Cellular' })
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty({ example: 'Maponya Square' })
  propertyName!: string

  @ApiProperty({ example: 'S01' })
  unitNumber!: string

  @ApiProperty({ format: 'date' })
  expiryDate!: string

  @ApiProperty({ description: 'Written notice required before expiry, in months.' })
  noticePeriodMonths!: number

  @ApiProperty({ format: 'date', description: 'Last day written renewal notice may be given: expiry less the notice period.' })
  deadline!: string

  @ApiProperty({ description: 'Signed days from the as-at date to the deadline; negative once passed.' })
  daysUntilDeadline!: number

  @ApiProperty({ enum: RENEWAL_DEADLINE_ROW_STATUSES, enumName: 'RenewalDeadlineRowStatus' })
  status!: RenewalDeadlineRowStatus

  @ApiPropertyOptional({ description: 'The company renewal warning threshold (days) reached: the one monitoring raises its renewal event for.' })
  warningThreshold?: number

  @ApiPropertyOptional({ format: 'uuid', description: 'The open renewal-notice-deadline monitoring event of the lease.' })
  openEventId?: string
}

export class RenewalDeadlineCountsDto implements Record<RenewalDeadlineRowStatus, number> {
  @ApiProperty()
  passed!: number

  @ApiProperty()
  due_critical!: number

  @ApiProperty()
  due_soon!: number

  @ApiProperty()
  upcoming!: number

  @ApiProperty()
  open!: number

  @ApiProperty()
  exercised!: number
}

export class RenewalDeadlinesReportDto implements RenewalDeadlinesReport {
  @ApiProperty({ type: [RenewalDeadlineRowDto], description: 'Verified renewal options with a notice period, soonest deadline first.' })
  rows!: RenewalDeadlineRowDto[]

  @ApiProperty({ type: RenewalDeadlineCountsDto })
  countsByStatus!: RenewalDeadlineCountsDto

  @ApiProperty({ description: 'Leases shown inside a company warning threshold: the leases monitoring raises a renewal event for.' })
  requiringWarning!: number

  @ApiProperty({ type: [Number], description: 'The company renewal warning thresholds in days, largest first; empty when the rule is off.' })
  warningDays!: number[]

  @ApiProperty({ description: 'Verified leases with an unexercised renewal option but no notice period recorded.' })
  missingNoticePeriod!: number

  @ApiProperty({ description: 'Leases that have not ended whose terms are not verified: not monitored, so not listed.' })
  unverifiedLeasesExcluded!: number
}

export class RenewalDeadlinesResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['renewal_deadlines'] })
  reportId!: 'renewal_deadlines'

  @ApiProperty({ type: RenewalDeadlinesReportDto })
  data!: RenewalDeadlinesReportDto
}
