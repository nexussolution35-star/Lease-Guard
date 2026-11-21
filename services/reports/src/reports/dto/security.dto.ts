import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DEPOSIT_HOLDERS, GUARANTEE_EXPIRY_STATES, type DepositsGuaranteesReport, type SecurityRow } from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

// ------------------------------------------------------------------------------------------ deposits and guarantees

export class SecurityRowDto implements SecurityRow {
  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty({ example: 'MSQ-L001' })
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

  @ApiProperty({ description: 'Monthly rental the verified terms expect as at the report date, escalations applied (ZAR, excl. VAT).' })
  expectedMonthlyRental!: number

  @ApiPropertyOptional({ description: 'Deposit held (ZAR).' })
  depositAmount?: number

  @ApiPropertyOptional({ enum: DEPOSIT_HOLDERS, enumName: 'DepositHolder' })
  depositHeldBy?: string

  @ApiPropertyOptional({ description: 'The deposit expressed as months of rental.' })
  depositBasisMonths?: number

  @ApiPropertyOptional({ description: 'Basis months × expected rental (ZAR); absent without a deposit basis.' })
  depositRequired?: number

  @ApiProperty({ description: 'Required deposit less the deposit held, never below zero (ZAR).' })
  depositShortfall!: number

  @ApiPropertyOptional({ example: 'Standard Bank' })
  guaranteeBank?: string

  @ApiPropertyOptional({ example: 'BG-0042' })
  guaranteeReference?: string

  @ApiPropertyOptional({ description: 'Bank guarantee amount (ZAR).' })
  guaranteeAmount?: number

  @ApiPropertyOptional({ description: 'The guarantee was sized as this many months of rental.' })
  guaranteeBasisMonths?: number

  @ApiPropertyOptional({ description: 'Basis months × expected rental (ZAR), for a guarantee recorded as active or expiring.' })
  guaranteeRequired?: number

  @ApiProperty({ description: 'Required guarantee less the guarantee amount, never below zero (ZAR).' })
  guaranteeShortfall!: number

  @ApiPropertyOptional({ format: 'date' })
  guaranteeExpiresOn?: string

  @ApiPropertyOptional({
    enum: GUARANTEE_EXPIRY_STATES,
    enumName: 'GuaranteeExpiryState',
    description: 'Released and called are final; else expired once the date has passed, expiring inside a notice threshold, else active.',
  })
  guaranteeState?: string

  @ApiPropertyOptional({ description: 'Days from the report date to the guarantee expiry (negative once expired).' })
  guaranteeDaysUntilExpiry?: number

  @ApiProperty({ description: 'A deposit or guarantee shortfall, or a guarantee expiring or expired.' })
  needsAttention!: boolean
}

export class DepositsGuaranteesReportDto implements DepositsGuaranteesReport {
  @ApiProperty({ description: 'Deposits held on the listed leases (ZAR).' })
  totalDeposits!: number

  @ApiProperty({ description: 'Guarantees in force (active or expiring) on the listed leases (ZAR).' })
  totalGuarantees!: number

  @ApiProperty()
  depositShortfallTotal!: number

  @ApiProperty()
  guaranteeShortfallTotal!: number

  @ApiProperty({ description: 'Listed leases with a deposit or a guarantee shortfall.' })
  leasesWithShortfall!: number

  @ApiProperty()
  expiringGuarantees!: number

  @ApiProperty()
  expiredGuarantees!: number

  @ApiProperty({ type: [Number], description: 'Guarantee expiry notice thresholds in days, largest first.', example: [90, 30] })
  guaranteeNoticeDays!: number[]

  @ApiProperty({ type: [SecurityRowDto] })
  rows!: SecurityRowDto[]

  @ApiProperty({ description: 'Leases with a deposit or guarantee that have not ended but whose terms are not verified: not listed.' })
  unverifiedLeasesExcluded!: number
}

export class DepositsGuaranteesResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['deposits_guarantees'] })
  reportId!: 'deposits_guarantees'

  @ApiProperty({ type: DepositsGuaranteesReportDto })
  data!: DepositsGuaranteesReportDto
}
