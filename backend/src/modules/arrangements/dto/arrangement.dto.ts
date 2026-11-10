import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ARRANGEMENT_STATUSES,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_STATUSES,
  type ArrangementInstallment,
  type ArrangementStatus,
  type InstallmentFrequency,
  type InstallmentStatus,
  type PaymentArrangement,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { ARRANGEMENT_SORT_FIELDS, type arrangementListQuerySchema } from '../arrangements.schemas'

export class ArrangementInstallmentDto implements ArrangementInstallment {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) arrangementId!: string
  @ApiProperty({ minimum: 1 }) sequence!: number
  @ApiProperty({ format: 'date' }) dueDate!: string
  @ApiProperty({ description: 'Rands (ZAR)' }) amount!: number
  @ApiProperty({ enum: INSTALLMENT_STATUSES, enumName: 'InstallmentStatus' }) status!: InstallmentStatus
  @ApiPropertyOptional({ format: 'date-time' }) reminderSentAt?: string
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Confirmed from an updated statement or by the property manager; LeaseGuard never verifies bank transactions',
  })
  confirmedByUserId?: string
  @ApiPropertyOptional({ format: 'date' }) confirmedOn?: string
  @ApiPropertyOptional() notes?: string
}

/** A recorded payment arrangement (monitoring record only; no payment processing). */
export class PaymentArrangementDto implements PaymentArrangement {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ format: 'uuid' }) tenantId!: string
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiProperty({ format: 'uuid' }) unitId!: string
  @ApiProperty({ format: 'uuid' }) leaseId!: string
  @ApiProperty({ description: 'Outstanding balance at the time of agreement, rands (ZAR)' }) outstandingBalance!: number
  @ApiProperty({ description: 'Rands (ZAR)' }) installmentAmount!: number
  @ApiProperty({ enum: INSTALLMENT_FREQUENCIES, enumName: 'InstallmentFrequency' }) frequency!: InstallmentFrequency
  @ApiProperty({ format: 'date' }) firstInstallmentDate!: string
  @ApiProperty({ format: 'date' }) finalInstallmentDate!: string
  @ApiProperty({ enum: ARRANGEMENT_STATUSES, enumName: 'ArrangementStatus' }) status!: ArrangementStatus
  @ApiProperty({ description: 'While active, normal arrears reminders are paused for this tenant' })
  suppressArrearsReminders!: boolean
  @ApiProperty({ format: 'uuid' }) agreedByUserId!: string
  @ApiProperty({ format: 'date' }) agreedOn!: string
  @ApiPropertyOptional({ format: 'date' }) closedOn?: string
  @ApiProperty() notes!: string
  @ApiProperty({ type: [ArrangementInstallmentDto] }) installments!: ArrangementInstallmentDto[]
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const PaymentArrangementPageDto = createPageDto(PaymentArrangementDto, 'PaymentArrangementPage')

export class ArrangementListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ARRANGEMENT_SORT_FIELDS, enumName: 'ArrangementSortField' })
  sort?: (typeof ARRANGEMENT_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: ARRANGEMENT_STATUSES, enumName: 'ArrangementStatus' })
  status?: ArrangementStatus

  @ApiPropertyOptional({ format: 'uuid' })
  leaseId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string
}

assertSchemaMatchesDto<z.infer<typeof arrangementListQuerySchema>, ArrangementListQueryDto>(true)
