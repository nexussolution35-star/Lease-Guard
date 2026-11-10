import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  WHATSAPP_CONNECTION_STATUSES,
  WHATSAPP_VERIFICATION_STEP_STATUSES,
  WHATSAPP_VERIFICATION_STEPS,
  type WhatsAppMessageTemplate,
  type WhatsAppVerificationStep,
  type WhatsAppVerificationStepResult,
  type WhatsAppVerificationStepStatus,
  type WhatsAppBusinessAccount,
  type WhatsAppConnectionStatus,
  type WhatsAppPhoneNumber,
} from '@leaseguard/domain'

import {
  type MissingSetting,
  SETTING_PROCESSES,
  type SettingProcess,
  WHATSAPP_CAPABILITIES,
  type WhatsAppCapabilities,
  type WhatsAppCapability,
} from '../whatsapp-capabilities'

/** One verification step of a number, as the worker last recorded it. Messages are written for the admin. */
export class WhatsAppVerificationStepDto implements WhatsAppVerificationStepResult {
  @ApiProperty({ enum: WHATSAPP_VERIFICATION_STEPS, enumName: 'WhatsAppVerificationStep' }) step!: WhatsAppVerificationStep
  @ApiProperty({
    enum: WHATSAPP_VERIFICATION_STEP_STATUSES,
    enumName: 'WhatsAppVerificationStepStatus',
    description: 'action_needed: waiting for the admin (the registration PIN); not_required counts as passed',
  })
  status!: WhatsAppVerificationStepStatus
  @ApiPropertyOptional({ description: 'What happened' }) message?: string
  @ApiPropertyOptional({ description: 'How to recover' }) recovery?: string
  @ApiPropertyOptional({ description: "Meta's error code, when Meta refused" }) metaErrorCode?: string
  @ApiPropertyOptional({ format: 'date-time' }) checkedAt?: string
}

/** One of the company's WhatsApp business numbers. Same shape as the domain `WhatsAppPhoneNumber`; never the credential. */
export class WhatsAppPhoneNumberDto implements WhatsAppPhoneNumber {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ description: 'Meta id of the WhatsApp Business Account the number belongs to' }) businessAccountId!: string
  @ApiProperty({ description: 'Meta phone number id (the receiving number of inbound messages)' }) phoneNumberId!: string
  @ApiProperty() displayName!: string
  @ApiProperty({ description: 'International number, e.g. +27 11 555 0100' }) displayNumber!: string
  @ApiPropertyOptional({ description: "Meta's verified display name" }) verifiedName?: string
  @ApiPropertyOptional({ description: "Meta's quality rating, e.g. GREEN" }) qualityRating?: string
  @ApiPropertyOptional({ description: "Meta's code verification status, e.g. VERIFIED" }) codeVerificationStatus?: string
  @ApiPropertyOptional({ description: "Meta's display-name review status, e.g. APPROVED" }) nameStatus?: string
  @ApiPropertyOptional({ description: "Meta's own status of the number, e.g. CONNECTED" }) metaStatus?: string
  @ApiProperty() webhookConfigured!: boolean
  @ApiProperty({
    enum: WHATSAPP_CONNECTION_STATUSES,
    enumName: 'WhatsAppConnectionStatus',
    description: 'connected only after LeaseGuard verified the number with Meta',
  })
  connectionStatus!: WhatsAppConnectionStatus
  @ApiPropertyOptional({ format: 'date-time' }) lastVerifiedAt?: string
  @ApiPropertyOptional({ format: 'date-time', description: "Meta's registration lock after too many attempts (error 133016)" })
  registrationBlockedUntil?: string
  @ApiProperty({ type: [WhatsAppVerificationStepDto], description: 'In step order; empty until verification first ran' })
  verificationSteps!: WhatsAppVerificationStepDto[]
  @ApiProperty({ format: 'date-time' }) createdAt!: string
}

/** A message template Meta holds for one of the company's WhatsApp Business Accounts, as last synced. */
export class WhatsAppMessageTemplateDto implements WhatsAppMessageTemplate {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ description: 'Meta id of the WhatsApp Business Account' }) businessAccountId!: string
  @ApiProperty() metaTemplateId!: string
  @ApiProperty() name!: string
  @ApiProperty({ description: 'Meta language code, e.g. en_ZA' }) language!: string
  @ApiProperty({ description: "Meta's category, e.g. UTILITY" }) category!: string
  @ApiProperty({ description: "Meta's review status, e.g. APPROVED, PENDING, REJECTED, PAUSED" }) status!: string
  @ApiPropertyOptional() rejectedReason?: string
  @ApiProperty({ format: 'date-time' }) syncedAt!: string
}

export class RegisterWhatsAppNumberDto {
  @ApiProperty({
    description: "6-digit PIN: the number's two-step verification PIN, or the one it will get. Used once, never stored",
    pattern: '^[0-9]{6}$',
    example: '123456',
  })
  pin!: string
}

export class WhatsAppVerificationRequestDto {
  @ApiProperty({ format: 'uuid' }) numberId!: string
  @ApiProperty({ enum: ['queued', 'already_running'], description: 'already_running: a run is waiting or in progress (for register: a waiting run, which reads the PIN)' })
  status!: 'queued' | 'already_running'
  @ApiProperty() message!: string
}

export class WhatsAppDisconnectResultDto {
  @ApiProperty({ format: 'uuid' }) numberId!: string
  @ApiProperty({ enum: ['disconnected'] }) status!: 'disconnected'
  @ApiProperty({ description: 'The stored business token was deleted (false when another number of the company in use still holds it, or the token is held in the worker environment)' })
  tokenRemoved!: boolean
  @ApiProperty() message!: string
}

/** A WhatsApp Business Account of the company with its numbers. Same shape as the domain `WhatsAppBusinessAccount`. */
export class WhatsAppBusinessAccountDto implements WhatsAppBusinessAccount {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ description: 'Meta id of the WhatsApp Business Account' }) businessAccountId!: string
  @ApiPropertyOptional({ description: 'Name Meta reports for the account' }) name?: string
  @ApiProperty({ type: [WhatsAppPhoneNumberDto], description: 'Oldest first' }) numbers!: WhatsAppPhoneNumberDto[]
  @ApiProperty({ format: 'date-time' }) createdAt!: string
}

export class MissingSettingDto implements MissingSetting {
  @ApiProperty({ enum: WHATSAPP_CAPABILITIES, enumName: 'WhatsAppCapability' }) capability!: WhatsAppCapability
  @ApiProperty({ description: 'Name of the environment setting (never its value)', example: 'WHATSAPP_APP_SECRET' }) setting!: string
  @ApiProperty({ enum: SETTING_PROCESSES, enumName: 'SettingProcess', description: 'The LeaseGuard process that reads the setting' })
  process!: SettingProcess
}

/** Public-safe WhatsApp capabilities of this LeaseGuard deployment. */
export class WhatsAppCapabilitiesDto implements WhatsAppCapabilities {
  @ApiProperty({ description: 'The API has the Meta app id, Embedded Signup configuration id and app secret' })
  embeddedSignupConfigured!: boolean
  @ApiProperty({ description: 'The API has the Meta app secret and the webhook verify token' }) webhookConfigured!: boolean
  @ApiProperty({ description: 'The worker reported an Anthropic API key for the AI agent runtime (false while no worker is reporting)' })
  agentRuntimeConfigured!: boolean
  @ApiProperty({
    description:
      'A worker reported within the last few minutes. When false the agent runtime status is unknown and ANTHROPIC_API_KEY is not listed as missing',
  })
  workerReporting!: boolean
  @ApiPropertyOptional({ description: 'Public Meta app id, for the Facebook JavaScript SDK' }) appId?: string
  @ApiPropertyOptional({ description: 'Public Embedded Signup (Facebook Login for Business) configuration id' })
  embeddedSignupConfigId?: string
  @ApiPropertyOptional({ format: 'date-time', description: 'When the worker last reported; absent when no worker has reported recently' })
  workerReportedAt?: string
  @ApiProperty({ type: [MissingSettingDto], description: 'Settings still needed, by capability' }) missing!: MissingSettingDto[]
}
