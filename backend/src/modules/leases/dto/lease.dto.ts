import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  DEPOSIT_HOLDERS,
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  GUARANTEE_STATUSES,
  LEASE_STATUSES,
  MAX_EXPIRING_WITHIN_DAYS,
  type BankGuarantee,
  type Deposit,
  type DepositHolder,
  type EscalationFrequency,
  type EscalationType,
  type GuaranteeStatus,
  type Lease,
  type LeaseEscalation,
  type LeaseListItem,
  type LeaseStatus,
  type RenewalOption,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPageDto, PageQueryDto } from '../../../common/http/pagination'
import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  LEASE_INITIAL_STATUSES,
  LEASE_SORT_FIELDS,
  type createLeaseBodySchema,
  type leaseDepositSchema,
  type leaseEscalationSchema,
  type leaseGuaranteeSchema,
  type leaseListQuerySchema,
  type leaseRenewalSchema,
  type updateLeaseBodySchema,
} from '../leases.schemas'

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

/** A lease in the list: the lease plus the names of its tenant, property and unit. */
export class LeaseListItemDto extends LeaseDto implements LeaseListItem {
  @ApiProperty({ description: "The tenant's trading name", example: 'Umoya Coffee' }) tenantName!: string
  @ApiProperty({ example: 'Acacia Park Shopping Centre' }) propertyName!: string
  @ApiProperty({ example: 'ACP-001' }) unitNumber!: string
}

export const LeasePageDto = createPageDto(LeaseListItemDto, 'LeasePage')

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

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: MAX_EXPIRING_WITHIN_DAYS,
    description: 'Leases expiring from today (South African date) to this many days from today, inclusive',
  })
  expiresWithinDays?: number
}

assertSchemaMatchesDto<z.infer<typeof leaseListQuerySchema>, LeaseListQueryDto>(true)

// --------------------------------------------------------------------------- create and edit

type InitialLeaseStatus = (typeof LEASE_INITIAL_STATUSES)[number]

/** Renewal option terms in a request. Whether the tenant exercised it is recorded separately. */
export class RenewalOptionInputDto {
  @ApiProperty() exists!: boolean
  @ApiPropertyOptional({ minimum: 1, maximum: 600, description: 'Length of the renewal term in months' }) renewalTermMonths?: number
  @ApiPropertyOptional({ minimum: 0, maximum: 120, description: 'Written notice required before expiry, in months' })
  noticePeriodMonths?: number
  @ApiPropertyOptional({ maxLength: 2000 }) notes?: string
}

/** A bank guarantee in a request. Its status (released, called) follows its lifecycle and is not set here. */
export class BankGuaranteeInputDto {
  @ApiProperty({ maxLength: 200 }) bank!: string
  @ApiProperty({ maxLength: 100 }) referenceNumber!: string
  @ApiProperty({ minimum: 0, description: 'Amount in ZAR, at most two decimals' }) amount!: number
  @ApiProperty({ minimum: 0, exclusiveMinimum: true, description: 'Months of rental the guarantee was sized as' }) basisMonths!: number
  @ApiProperty({ format: 'date' }) issuedOn!: string
  @ApiProperty({ format: 'date', description: 'After the issue date' }) expiresOn!: string
  @ApiPropertyOptional({ maxLength: 2000 }) notes?: string
}

/** Body of POST /leases. Amounts are ZAR excluding VAT. */
export class CreateLeaseDto {
  @ApiProperty({ maxLength: 40, example: 'MSQ-L012', description: 'Upper-cased; unique in the company' }) reference!: string
  @ApiProperty({ format: 'uuid', description: 'A tenant of the company' }) tenantId!: string
  @ApiProperty({ format: 'uuid', description: 'A property of the company that is not archived' }) propertyId!: string
  @ApiProperty({ format: 'uuid', description: 'A unit of that property' }) unitId!: string
  @ApiProperty({ format: 'date' }) commencementDate!: string
  @ApiProperty({ format: 'date', description: 'After the commencement date' }) expiryDate!: string
  @ApiProperty({ minimum: 0, description: 'Rental at commencement (ZAR, excl. VAT)' }) initialMonthlyRental!: number
  @ApiPropertyOptional({ minimum: 0, description: 'The initial rental when omitted' }) currentMonthlyRental?: number
  @ApiProperty({ minimum: 1, maximum: 28 }) paymentDueDay!: number
  @ApiProperty({ type: LeaseEscalationDto, description: 'The amount field its type names is required' }) escalation!: LeaseEscalationDto
  @ApiProperty({ type: RenewalOptionInputDto }) renewalOption!: RenewalOptionInputDto
  @ApiPropertyOptional({ type: DepositDto, nullable: true }) deposit?: DepositDto | null
  @ApiPropertyOptional({ type: BankGuaranteeInputDto, nullable: true }) bankGuarantee?: BankGuaranteeInputDto | null
  @ApiPropertyOptional({ enum: LEASE_INITIAL_STATUSES, enumName: 'InitialLeaseStatus', description: 'pending_verification when omitted' })
  status?: InitialLeaseStatus
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 4000 }) notes?: string | null
}

/**
 * Body of PATCH /leases/{leaseId}. Omitted fields are unchanged; escalation, renewal option, deposit and bank guarantee
 * each replace the whole group. A change to a lease term (parties, dates, rentals, due day, escalation, renewal
 * option, deposit, guarantee) of a verified lease returns it to pending verification.
 */
export class UpdateLeaseDto {
  @ApiPropertyOptional({ maxLength: 40 }) reference?: string
  @ApiPropertyOptional({ format: 'uuid' }) tenantId?: string
  @ApiPropertyOptional({ format: 'uuid', description: 'Send the unit with it' }) propertyId?: string
  @ApiPropertyOptional({ format: 'uuid' }) unitId?: string
  @ApiPropertyOptional({ format: 'date' }) commencementDate?: string
  @ApiPropertyOptional({ format: 'date' }) expiryDate?: string
  @ApiPropertyOptional({ minimum: 0 }) initialMonthlyRental?: number
  @ApiPropertyOptional({ minimum: 0 }) currentMonthlyRental?: number
  @ApiPropertyOptional({ minimum: 1, maximum: 28 }) paymentDueDay?: number
  @ApiPropertyOptional({ type: LeaseEscalationDto }) escalation?: LeaseEscalationDto
  @ApiPropertyOptional({ type: RenewalOptionInputDto }) renewalOption?: RenewalOptionInputDto
  @ApiPropertyOptional({ type: DepositDto, nullable: true, description: 'null removes the deposit' }) deposit?: DepositDto | null
  @ApiPropertyOptional({ type: BankGuaranteeInputDto, nullable: true, description: 'null removes the guarantee' })
  bankGuarantee?: BankGuaranteeInputDto | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 4000, description: 'Empty or null clears it' }) notes?: string | null
}

assertSchemaMatchesDto<z.infer<typeof leaseEscalationSchema>, LeaseEscalationDto>(true)
assertSchemaMatchesDto<z.infer<typeof leaseRenewalSchema>, RenewalOptionInputDto>(true)
assertSchemaMatchesDto<z.infer<typeof leaseDepositSchema>, DepositDto>(true)
assertSchemaMatchesDto<z.infer<typeof leaseGuaranteeSchema>, BankGuaranteeInputDto>(true)
assertSchemaMatchesDto<z.infer<typeof createLeaseBodySchema>, CreateLeaseDto>(true)
assertSchemaMatchesDto<z.infer<typeof updateLeaseBodySchema>, UpdateLeaseDto>(true)
