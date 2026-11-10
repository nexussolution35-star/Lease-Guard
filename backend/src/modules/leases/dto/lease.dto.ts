import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  DEPOSIT_HOLDERS,
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  GUARANTEE_STATUSES,
  LEASE_STATUSES,
  type BankGuarantee,
  type Deposit,
  type DepositHolder,
  type EscalationFrequency,
  type EscalationType,
  type GuaranteeStatus,
  type Lease,
  type LeaseEscalation,
  type LeaseStatus,
  type RenewalOption,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import { LEASE_SORT_FIELDS, type leaseListQuerySchema } from '../leases.schemas'

/** Agreed rental increase conditions. Same shape as the domain `LeaseEscalation`. */
export class LeaseEscalationDto implements LeaseEscalation {
  @ApiProperty({ enum: ESCALATION_TYPES, enumName: 'EscalationType' }) type!: EscalationType
  @ApiPropertyOptional({ description: 'Percentage per interval, e.g. 8 for 8%; set when type is percentage' })
  percentage?: number
  @ApiPropertyOptional({ description: 'Rand increase per interval (ZAR); set when type is fixed_amount' })
  fixedAmount?: number
  @ApiPropertyOptional({ description: 'Assumed CPI percentage; set when type is cpi_linked' })
  cpiAssumedPercentage?: number
  @ApiPropertyOptional({ description: 'Margin above CPI, in percent' }) cpiMarginPercentage?: number
  @ApiProperty({ enum: ESCALATION_FREQUENCIES, enumName: 'EscalationFrequency' }) frequency!: EscalationFrequency
  @ApiProperty({ format: 'date' }) firstEscalationDate!: string
}

/** Same shape as the domain `RenewalOption`. */
export class RenewalOptionDto implements RenewalOption {
  @ApiProperty() exists!: boolean
  @ApiPropertyOptional({ description: 'Length of the renewal term in months' }) renewalTermMonths?: number
  @ApiPropertyOptional({ description: 'Written notice required before expiry, in months' }) noticePeriodMonths?: number
  @ApiProperty() exercised!: boolean
  @ApiPropertyOptional({ format: 'date' }) exercisedOn?: string
  @ApiPropertyOptional() notes?: string
}

/** Same shape as the domain `Deposit`. */
export class DepositDto implements Deposit {
  @ApiProperty({ description: 'Amount in ZAR' }) amount!: number
  @ApiPropertyOptional({ description: 'Deposit as months of initial rental' }) basisMonths?: number
  @ApiProperty({ enum: DEPOSIT_HOLDERS, enumName: 'DepositHolder' }) heldBy!: DepositHolder
  @ApiPropertyOptional({ format: 'date' }) receivedOn?: string
  @ApiProperty() interestBearing!: boolean
  @ApiPropertyOptional() notes?: string
}

/** Same shape as the domain `BankGuarantee`. */
export class BankGuaranteeDto implements BankGuarantee {
  @ApiProperty() bank!: string
  @ApiProperty() referenceNumber!: string
  @ApiProperty({ description: 'Amount in ZAR' }) amount!: number
  @ApiProperty({ description: 'Months of rental the guarantee was sized as at issue' }) basisMonths!: number
  @ApiProperty({ format: 'date' }) issuedOn!: string
  @ApiProperty({ format: 'date' }) expiresOn!: string
  @ApiProperty({ enum: GUARANTEE_STATUSES, enumName: 'GuaranteeStatus' }) status!: GuaranteeStatus
  @ApiPropertyOptional() notes?: string
}

/** A lease in the active company. Same shape as the domain `Lease`. Amounts are ZAR excluding VAT. */
export class LeaseDto implements Lease {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ example: 'MSQ-L012' }) reference!: string
  @ApiProperty({ format: 'uuid' }) propertyId!: string
  @ApiProperty({ format: 'uuid' }) unitId!: string
  @ApiProperty({ format: 'uuid' }) tenantId!: string
  @ApiProperty({ format: 'date' }) commencementDate!: string
  @ApiProperty({ format: 'date' }) expiryDate!: string
  @ApiProperty({ description: 'Rental at commencement (ZAR, excl. VAT)' }) initialMonthlyRental!: number
  @ApiProperty({ description: 'Contractual rental after applied escalations (ZAR, excl. VAT)' })
  currentMonthlyRental!: number
  @ApiProperty({ minimum: 1, maximum: 28 }) paymentDueDay!: number
  @ApiProperty({ type: LeaseEscalationDto }) escalation!: LeaseEscalationDto
  @ApiProperty({ type: RenewalOptionDto }) renewalOption!: RenewalOptionDto
  @ApiPropertyOptional({ type: DepositDto }) deposit?: DepositDto
  @ApiPropertyOptional({ type: BankGuaranteeDto }) bankGuarantee?: BankGuaranteeDto
  @ApiProperty({ enum: LEASE_STATUSES, enumName: 'LeaseStatus' }) status!: LeaseStatus
  @ApiProperty({ description: 'Lease terms must be verified before they drive financial monitoring' })
  verified!: boolean
  @ApiPropertyOptional({ format: 'uuid' }) verifiedByUserId?: string
  @ApiPropertyOptional({ format: 'date-time' }) verifiedAt?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Lease this one renewed' }) previousLeaseId?: string
  @ApiPropertyOptional() notes?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export const LeasePageDto = createPageDto(LeaseDto, 'LeasePage')

export class LeaseListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: LEASE_SORT_FIELDS, enumName: 'LeaseSortField' })
  sort?: (typeof LEASE_SORT_FIELDS)[number]

  @ApiPropertyOptional({ enum: LEASE_STATUSES, enumName: 'LeaseStatus' })
  status?: LeaseStatus

  @ApiPropertyOptional({ format: 'uuid' })
  propertyId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  unitId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  tenantId?: string

  @ApiPropertyOptional({ type: Boolean, description: 'true for verified leases only, false for unverified only' })
  verified?: boolean
}

assertSchemaMatchesDto<z.infer<typeof leaseListQuerySchema>, LeaseListQueryDto>(true)
