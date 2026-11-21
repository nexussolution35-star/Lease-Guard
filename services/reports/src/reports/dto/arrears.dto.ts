import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ARRANGEMENT_STATUSES,
  INSTALLMENT_FREQUENCIES,
  type ArrangementRow,
  type ArrangementStatus,
  type ArrearsBucketRow,
  type ArrearsReport,
  type ArrearsRow,
  type InstallmentFrequency,
  type PaymentArrangementsReport,
} from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

// ------------------------------------------------------------------------------------------ arrears

export class ArrearsRowDto implements ArrearsRow {
  @ApiProperty({ format: 'uuid' })
  tenantId!: string

  @ApiProperty({ example: 'Dlamini Cellular' })
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiPropertyOptional({ format: 'uuid' })
  unitId?: string

  @ApiPropertyOptional({ example: 'S01' })
  unitNumber?: string

  @ApiPropertyOptional({ format: 'uuid' })
  leaseId?: string

  @ApiPropertyOptional({ example: 'MSQ-L001' })
  leaseReference?: string

  @ApiProperty({ format: 'uuid', description: 'The latest verified statement of the account, the balance comes from.' })
  statementId!: string

  @ApiProperty({ format: 'date' })
  statementDate!: string

  @ApiProperty({ description: 'Closing balance, else total due, of that statement (ZAR).' })
  outstanding!: number

  @ApiProperty({ description: 'Days from the statement date to the as-at date.' })
  ageDays!: number

  @ApiProperty({ description: "Ageing bucket label: 'current', a boundary in days ('30') or the open-ended last one ('120+').", example: '30' })
  bucket!: string

  @ApiProperty({ description: 'An active payment arrangement is in force for the tenant; the balance is still owed.' })
  underArrangement!: boolean

  @ApiProperty({ description: "That arrangement pauses the tenant's normal arrears reminders." })
  remindersSuppressed!: boolean

  @ApiPropertyOptional({ format: 'uuid', description: 'The active arrangement in force (the latest agreed).' })
  arrangementId?: string
}

export class ArrearsBucketRowDto implements ArrearsBucketRow {
  @ApiProperty({ example: '30' })
  bucket!: string

  @ApiProperty({ example: '30–59 days' })
  description!: string

  @ApiProperty({ description: 'ZAR' })
  amount!: number

  @ApiProperty()
  tenantCount!: number
}

export class ArrearsReportDto implements ArrearsReport {
  @ApiProperty({ type: [Number], description: "The company's ageing bucket boundaries in days.", example: [30, 60, 90, 120] })
  ageingBuckets!: number[]

  @ApiProperty()
  totalOutstanding!: number

  @ApiProperty({ description: 'Distinct tenants in arrears.' })
  tenantCount!: number

  @ApiProperty()
  tenantsUnderArrangement!: number

  @ApiProperty()
  tenantsWithRemindersSuppressed!: number

  @ApiProperty()
  outstandingUnderArrangement!: number

  @ApiProperty({ type: [ArrearsBucketRowDto] })
  buckets!: ArrearsBucketRowDto[]

  @ApiProperty({ type: [ArrearsRowDto], description: 'Largest balance first.' })
  rows!: ArrearsRowDto[]
}

export class ArrearsResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['arrears'] })
  reportId!: 'arrears'

  @ApiProperty({ type: ArrearsReportDto })
  data!: ArrearsReportDto
}

// ------------------------------------------------------------------------------------------ payment arrangements

export class ArrangementRowDto implements ArrangementRow {
  @ApiProperty({ format: 'uuid' })
  arrangementId!: string

  @ApiProperty({ format: 'uuid' })
  tenantId!: string

  @ApiProperty()
  tenantName!: string

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiProperty({ format: 'uuid' })
  unitId!: string

  @ApiProperty()
  unitNumber!: string

  @ApiProperty({ format: 'uuid' })
  leaseId!: string

  @ApiProperty()
  leaseReference!: string

  @ApiProperty({ enum: ARRANGEMENT_STATUSES, enumName: 'ArrangementStatus' })
  status!: ArrangementStatus

  @ApiProperty({ enum: INSTALLMENT_FREQUENCIES, enumName: 'InstallmentFrequency' })
  frequency!: InstallmentFrequency

  @ApiProperty()
  installmentAmount!: number

  @ApiProperty({ format: 'date' })
  agreedOn!: string

  @ApiProperty({ format: 'date' })
  finalInstallmentDate!: string

  @ApiPropertyOptional({ format: 'date' })
  closedOn?: string

  @ApiProperty()
  suppressArrearsReminders!: boolean

  @ApiProperty({ description: 'Outstanding balance at the time of agreement (ZAR).' })
  outstandingBalance!: number

  @ApiProperty({ description: 'Instalments recorded as paid (ZAR); LeaseGuard never takes payments.' })
  paid!: number

  @ApiProperty()
  remaining!: number

  @ApiProperty()
  paidCount!: number

  @ApiProperty()
  totalCount!: number

  @ApiProperty({ description: 'Instalments recorded as missed.' })
  missedCount!: number

  @ApiProperty({ description: "Open instalments past their due date plus the company's grace days (active arrangements only)." })
  overdueCount!: number

  @ApiPropertyOptional({ format: 'date' })
  nextDueDate?: string

  @ApiPropertyOptional()
  nextAmount?: number
}

export class ArrangementStatusCountsDto implements Record<ArrangementStatus, number> {
  @ApiProperty()
  proposed!: number

  @ApiProperty()
  active!: number

  @ApiProperty()
  completed!: number

  @ApiProperty()
  defaulted!: number

  @ApiProperty()
  cancelled!: number
}

export class PaymentArrangementsReportDto implements PaymentArrangementsReport {
  @ApiProperty({ description: 'Grace days after a due date before an instalment counts as overdue.' })
  graceDays!: number

  @ApiProperty({ type: ArrangementStatusCountsDto })
  countsByStatus!: ArrangementStatusCountsDto

  @ApiProperty({ description: 'Arrangements in force on the as-at date.' })
  activeCount!: number

  @ApiProperty({ description: 'Remaining balance of the active arrangements (ZAR).' })
  outstandingUnderArrangement!: number

  @ApiProperty({ description: 'Paid instalments recorded (ZAR).' })
  paidToDate!: number

  @ApiProperty()
  missedInstallments!: number

  @ApiProperty()
  overdueInstallments!: number

  @ApiProperty({ type: [ArrangementRowDto] })
  rows!: ArrangementRowDto[]
}

export class PaymentArrangementsResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['payment_arrangements'] })
  reportId!: 'payment_arrangements'

  @ApiProperty({ type: PaymentArrangementsReportDto })
  data!: PaymentArrangementsReportDto
}
