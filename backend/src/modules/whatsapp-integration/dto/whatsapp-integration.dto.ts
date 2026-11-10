import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  WHATSAPP_CONNECTION_STATUSES,
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
  @ApiProperty({ format: 'date-time' }) createdAt!: string
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
