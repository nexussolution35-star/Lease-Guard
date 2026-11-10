import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  COMPANY_STATUSES,
  SA_PROVINCES,
  WEEKDAYS,
  WHATSAPP_CONNECTION_STATUSES,
  type Company,
  type OnboardingChecklist,
  type SAProvince,
  type CompanySettings,
  type CompanyStatus,
  type WhatsAppSummary,
  type WhatsAppConnectionStatus,
  type Weekday,
} from '@leaseguard/domain'

// One OpenAPI `AddressDto` schema is shared by every resource with an address.
import { AddressDto } from '../../properties/dto/property.dto'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { CompanySummary } from '../companies.mapper'
import type { configureWhatsAppBodySchema, updateCompanyBodySchema } from '../companies.schemas'

/** The company's WhatsApp numbers at a glance. Same shape as the domain `WhatsAppSummary`. */
export class WhatsAppSummaryDto implements WhatsAppSummary {
  @ApiProperty({
    enum: WHATSAPP_CONNECTION_STATUSES,
    enumName: 'WhatsAppConnectionStatus',
    description:
      'connected when the company has a connected number to send from; otherwise the status of its earliest number; ' +
      'not_configured without numbers. Details: GET /integrations/whatsapp/business-accounts',
  })
  connectionStatus!: WhatsAppConnectionStatus
  @ApiProperty({ minimum: 0 }) numberCount!: number
  @ApiProperty({ minimum: 0 }) connectedNumberCount!: number
}

type PaymentReminderOffsets = CompanySettings['paymentReminderOffsetsDays']

export class PaymentReminderOffsetsDto implements PaymentReminderOffsets {
  @ApiProperty({ minimum: 0, description: 'Days after the statement date' }) initial!: number
  @ApiProperty({ description: 'Days after the statement date' }) overdue!: number
  @ApiProperty({ description: 'Days after the statement date' }) followUp!: number
}

/**
 * Monitoring intervals and communication defaults. Same shape as the domain `CompanySettings`. Tenant
 * messages always need property-manager approval, so there is no setting for it.
 */
export class CompanySettingsDto implements CompanySettings {
  @ApiProperty({ type: [Number], description: 'Days before lease expiry at which expiry events are raised' })
  leaseExpiryNoticeDays!: number[]
  @ApiProperty({ type: [Number], description: 'Days before a renewal notice deadline at which warnings are raised' })
  renewalDeadlineWarningDays!: number[]
  @ApiProperty({ type: [Number], description: 'Days before guarantee expiry at which expiry events are raised' })
  guaranteeExpiryNoticeDays!: number[]
  @ApiProperty({ type: PaymentReminderOffsetsDto }) paymentReminderOffsetsDays!: PaymentReminderOffsetsDto
  @ApiProperty({ minimum: 0, description: 'Days before an instalment due date to send its reminder' })
  installmentReminderLeadDays!: number
  @ApiProperty({ enum: WEEKDAYS, enumName: 'Weekday' }) ownerSummaryWeekday!: Weekday
  @ApiProperty({ enum: ['Africa/Johannesburg'] }) timezone!: 'Africa/Johannesburg'
}

/** A company (workspace). Same shape as the domain `Company`. */
export class CompanyDto implements Company {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiPropertyOptional() tradingName?: string
  @ApiPropertyOptional() registrationNumber?: string
  @ApiPropertyOptional() vatNumber?: string
  @ApiProperty({ type: AddressDto }) address!: AddressDto
  @ApiProperty({ format: 'email' }) contactEmail!: string
  @ApiProperty() contactPhone!: string
  @ApiProperty({ enum: COMPANY_STATUSES, enumName: 'CompanyStatus' }) status!: CompanyStatus
  @ApiProperty({ pattern: '^[A-Z]{2}$', description: 'Initials shown in the workspace switcher' }) initials!: string
  @ApiProperty({ type: WhatsAppSummaryDto }) whatsapp!: WhatsAppSummaryDto
  @ApiProperty({ type: CompanySettingsDto }) settings!: CompanySettingsDto
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

/** The company fields shown in the workspace switcher (a subset of the domain `Company`). */
export class CompanySummaryDto implements CompanySummary {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiPropertyOptional() tradingName?: string
  @ApiProperty({ pattern: '^[A-Z]{2}$' }) initials!: string
  @ApiProperty({ enum: COMPANY_STATUSES, enumName: 'CompanyStatus' }) status!: CompanyStatus
}

/** A new address for the company; replaces the whole address. */
export class UpdateCompanyAddressDto {
  @ApiProperty({ maxLength: 200 }) line1!: string
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, description: 'Empty or null clears it' })
  line2?: string | null
  @ApiProperty({ maxLength: 100 }) suburb!: string
  @ApiProperty({ maxLength: 100 }) city!: string
  @ApiProperty({ enum: SA_PROVINCES, enumName: 'SAProvince' }) province!: SAProvince
  @ApiProperty({ pattern: '^[0-9]{4}$' }) postalCode!: string
}

/** Monitoring settings a company_admin may change. Omitted settings are unchanged. */
export class UpdateCompanySettingsDto {
  @ApiPropertyOptional({ type: [Number], description: 'Distinct positive days before lease expiry' })
  leaseExpiryNoticeDays?: number[]
  @ApiPropertyOptional({ type: [Number], description: 'Distinct positive days before a renewal notice deadline' })
  renewalDeadlineWarningDays?: number[]
  @ApiPropertyOptional({ type: [Number], description: 'Distinct positive days before guarantee expiry' })
  guaranteeExpiryNoticeDays?: number[]
  @ApiPropertyOptional({ type: PaymentReminderOffsetsDto, description: 'All three offsets, increasing: initial < overdue < followUp' })
  paymentReminderOffsetsDays?: PaymentReminderOffsetsDto
  @ApiPropertyOptional({ minimum: 0, maximum: 60 }) installmentReminderLeadDays?: number
  @ApiPropertyOptional({ enum: WEEKDAYS, enumName: 'Weekday' }) ownerSummaryWeekday?: Weekday
}

/**
 * Body of PATCH /companies/:companyId. Omitted fields are unchanged; an empty string or null clears an
 * optional field. Status, initials and the timezone are managed by Nexus and cannot be changed here.
 * Tenant messages always need approval, so there is no approval setting to change.
 */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 }) name?: string
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) tradingName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 }) registrationNumber?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 30 }) vatNumber?: string | null
  @ApiPropertyOptional({ type: UpdateCompanyAddressDto }) address?: UpdateCompanyAddressDto
  @ApiPropertyOptional({ format: 'email', maxLength: 320 }) contactEmail?: string
  @ApiPropertyOptional({ minLength: 1, maxLength: 30 }) contactPhone?: string
  @ApiPropertyOptional({ type: UpdateCompanySettingsDto }) settings?: UpdateCompanySettingsDto
}

/** Body of PUT /companies/:companyId/whatsapp. */
export class ConfigureWhatsAppDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: "LeaseGuard id of the company's number to correct (e.g. a mistyped phone number id). Omit to add a number.",
  })
  numberId?: string
  @ApiProperty({ pattern: '^[0-9]{5,32}$', description: 'WhatsApp Business Account id (Meta)' }) businessAccountId!: string
  @ApiProperty({ pattern: '^[0-9]{5,32}$', description: 'Phone number id (Meta)' }) phoneNumberId!: string
  @ApiProperty({ minLength: 1, maxLength: 100 }) displayName!: string
  @ApiProperty({ description: 'Number shown to tenants, e.g. +27 11 555 0100' }) displayNumber!: string
}

/** Onboarding progress of a company: true per finished step. Same shape as the domain `OnboardingChecklist`. */
export class OnboardingChecklistDto implements OnboardingChecklist {
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ description: 'Name, address and contact details are filled in (required)' }) companyDetails!: boolean
  @ApiProperty({ description: 'The company has at least one WhatsApp number (required)' }) whatsappConfigured!: boolean
  @ApiProperty({ description: 'At least one WhatsApp number is verified and connected (required)' }) whatsappConnected!: boolean
  @ApiProperty({ description: 'More than one member, or any invitation (recommended, not required)' }) teamInvited!: boolean
  @ApiProperty({ description: 'At least one property exists (required)' }) propertyAdded!: boolean
  @ApiProperty({ description: 'At least one lease is verified (required)' }) leaseVerified!: boolean
  @ApiProperty({ description: 'At least one statement was uploaded (required)' }) statementUploaded!: boolean
  @ApiProperty({ description: 'Every required step is done' }) complete!: boolean
}

assertSchemaMatchesDto<z.infer<typeof updateCompanyBodySchema>, UpdateCompanyDto>(true)
assertSchemaMatchesDto<z.infer<typeof configureWhatsAppBodySchema>, ConfigureWhatsAppDto>(true)
