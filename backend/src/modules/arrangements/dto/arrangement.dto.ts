import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ARRANGEMENT_CLOSE_OUTCOMES,
  ARRANGEMENT_STATUSES,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_STATUSES,
  type ArrangementCloseOutcome,
  type ArrangementInstallment,
  type ArrangementStatus,
  type InstallmentFrequency,
  type InstallmentStatus,
  type PaymentArrangementListItem,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  ARRANGEMENT_SORT_FIELDS,
  INSTALLMENT_OUTCOME_CHOICES,
  OPEN_ARRANGEMENT_STATUSES,
  type arrangementListQuerySchema,
  type cancelArrangementBodySchema,
  type closeArrangementBodySchema,
  type createArrangementBodySchema,
  type installmentOutcomeBodySchema,
  type updateArrangementBodySchema,
} from '../arrangements.schemas'

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
  @ApiPropertyOptional({ format: 'uuid', description: 'Who recorded the outcome (paid, missed or waived)' })
  outcomeRecordedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) outcomeRecordedAt?: string
  @ApiPropertyOptional() notes?: string
}

/** A recorded payment arrangement (monitoring record only; no payment processing). */
export class PaymentArrangementDto implements PaymentArrangementListItem {
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
  @ApiPropertyOptional({ format: 'uuid', description: 'Who closed or cancelled it' }) closedByUserId?: string
  @ApiPropertyOptional({ description: 'Why it was closed or cancelled' }) closeReason?: string
  @ApiProperty() notes!: string
  @ApiProperty({ type: [ArrangementInstallmentDto] }) installments!: ArrangementInstallmentDto[]
  @ApiProperty({ description: "The tenant's trading name" }) tenantName!: string
  @ApiProperty() propertyName!: string
  @ApiProperty() unitNumber!: string
  @ApiProperty() leaseReference!: string
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

  @ApiPropertyOptional({ format: 'uuid' })
  propertyId?: string
}

assertSchemaMatchesDto<z.infer<typeof arrangementListQuerySchema>, ArrangementListQueryDto>(true)

type OpenArrangementStatus = (typeof OPEN_ARRANGEMENT_STATUSES)[number]
type InstallmentOutcomeChoice = (typeof INSTALLMENT_OUTCOME_CHOICES)[number]

/** Body of POST /arrangements (a monitoring record of an agreement; no payment is collected). */
export class CreateArrangementDto {
  @ApiProperty({ format: 'uuid', description: 'A tenant of the company' }) tenantId!: string
  @ApiProperty({ format: 'uuid', description: 'The property the arrears are at' }) propertyId!: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Narrows the lease when the tenant has several units at the property' })
  unitId?: string
  @ApiPropertyOptional({ format: 'uuid', description: "The lease the arrears are under; else the tenant's single lease in force at the property" })
  leaseId?: string
  @ApiProperty({ minimum: 0.01, description: 'Outstanding balance at the time of agreement, rands (ZAR)' }) outstandingBalance!: number
  @ApiProperty({ minimum: 0.01, description: 'Agreed instalment, rands (ZAR); at most the outstanding balance' })
  installmentAmount!: number
  @ApiProperty({ enum: INSTALLMENT_FREQUENCIES, enumName: 'InstallmentFrequency' }) frequency!: InstallmentFrequency
  @ApiProperty({ format: 'date', description: 'On or after the agreement date' }) firstInstallmentDate!: string
  @ApiPropertyOptional({ format: 'date', description: "The schedule's last due date; refused when it disagrees" })
  finalInstallmentDate?: string
  @ApiPropertyOptional({ enum: OPEN_ARRANGEMENT_STATUSES, enumName: 'OpenArrangementStatus', description: 'active when omitted' })
  status?: OpenArrangementStatus
  @ApiPropertyOptional({ format: 'date', description: 'Today (South Africa) when omitted; never in the future' }) agreedOn?: string
  @ApiPropertyOptional({ maxLength: 4000 }) notes?: string
}

/** Body of PATCH /arrangements/{arrangementId}. Omitted fields are unchanged. */
export class UpdateArrangementDto {
  @ApiPropertyOptional({ minimum: 0.01 }) outstandingBalance?: number
  @ApiPropertyOptional({ minimum: 0.01 }) installmentAmount?: number
  @ApiPropertyOptional({ enum: INSTALLMENT_FREQUENCIES, enumName: 'InstallmentFrequency' }) frequency?: InstallmentFrequency
  @ApiPropertyOptional({ format: 'date' }) firstInstallmentDate?: string
  @ApiPropertyOptional({ format: 'date', description: 'Follows the schedule when omitted' }) finalInstallmentDate?: string
  @ApiPropertyOptional({ format: 'date' }) agreedOn?: string
  @ApiPropertyOptional({ enum: OPEN_ARRANGEMENT_STATUSES, enumName: 'OpenArrangementStatus', description: 'proposed -> active only' })
  status?: OpenArrangementStatus
  @ApiPropertyOptional({ maxLength: 4000 }) notes?: string
}

/** Body of POST /arrangements/{arrangementId}/close. */
export class CloseArrangementDto {
  @ApiProperty({ enum: ARRANGEMENT_CLOSE_OUTCOMES, enumName: 'ArrangementCloseOutcome' }) outcome!: ArrangementCloseOutcome
  @ApiPropertyOptional({ maxLength: 1000 }) reason?: string
}

/** Body of POST /arrangements/{arrangementId}/cancel. */
export class CancelArrangementDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) reason!: string
}

/** Body of POST /arrangements/{arrangementId}/installments/{installmentId}/outcome. */
export class InstallmentOutcomeDto {
  @ApiProperty({
    enum: INSTALLMENT_OUTCOME_CHOICES,
    enumName: 'InstallmentOutcomeChoice',
    description: 'paid (confirmed_paid), missed or waived as the property manager confirms it; scheduled clears it',
  })
  outcome!: InstallmentOutcomeChoice
  @ApiPropertyOptional({ maxLength: 1000 }) note?: string
}

assertSchemaMatchesDto<z.infer<typeof createArrangementBodySchema>, CreateArrangementDto>(true)
assertSchemaMatchesDto<z.infer<typeof updateArrangementBodySchema>, UpdateArrangementDto>(true)
assertSchemaMatchesDto<z.infer<typeof closeArrangementBodySchema>, CloseArrangementDto>(true)
assertSchemaMatchesDto<z.infer<typeof cancelArrangementBodySchema>, CancelArrangementDto>(true)
assertSchemaMatchesDto<z.infer<typeof installmentOutcomeBodySchema>, InstallmentOutcomeDto>(true)
