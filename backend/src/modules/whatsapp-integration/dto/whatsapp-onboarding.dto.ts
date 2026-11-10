import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { OnboardingResult, OnboardingSessionStart } from '../whatsapp-onboarding.service'
import {
  type completeOnboardingBodySchema,
  EMBEDDED_SIGNUP_EVENTS,
  type EmbeddedSignupEvent,
  type embeddedSignupSessionInfoSchema,
} from '../whatsapp-onboarding.schemas'

export class EmbeddedSignupExtrasDto {
  @ApiProperty({ enum: ['v5'], description: 'Embedded Signup version for FB.login extras' }) version!: 'v5'
}

/** What the browser needs to open Meta's Embedded Signup popup. Public values only. */
export class WhatsAppOnboardingSessionDto implements OnboardingSessionStart {
  @ApiProperty({ format: 'uuid' }) sessionId!: string
  @ApiProperty({ description: 'Single-use state to send back with the result (only its hash is stored)', pattern: '^[0-9a-f]{64}$' })
  state!: string
  @ApiProperty({ format: 'date-time', description: 'The session must be completed before this time (15 minutes)' }) expiresAt!: string
  @ApiProperty({ description: 'Public Meta app id for FB.init' }) appId!: string
  @ApiProperty({ description: 'Embedded Signup (Facebook Login for Business) configuration id for FB.login' }) configId!: string
  @ApiProperty({ example: 'v27.0', description: 'Graph API version for FB.init' }) graphApiVersion!: string
  @ApiProperty({ type: EmbeddedSignupExtrasDto }) extras!: EmbeddedSignupExtrasDto
}

/**
 * The `data` of Meta's WA_EMBEDDED_SIGNUP message as the browser received it (snake_case as Meta sends it).
 * v5 sends messaging_account_ids, v4 waba_id. Other fields Meta sends are ignored.
 */
export class EmbeddedSignupSessionInfoDto {
  @ApiPropertyOptional({ pattern: '^[0-9]{1,32}$' }) phone_number_id?: string
  @ApiPropertyOptional({ pattern: '^[0-9]{1,32}$', description: 'v4: the shared WhatsApp Business (messaging) Account' }) waba_id?: string
  @ApiPropertyOptional({ type: [String], maxItems: 20, description: 'v5: the shared messaging accounts' }) messaging_account_ids?: string[]
  @ApiPropertyOptional({ pattern: '^[0-9]{1,32}$', description: "The customer's business portfolio" }) business_id?: string
  @ApiPropertyOptional() is_on_biz_app?: boolean
  @ApiPropertyOptional({ maxLength: 100, description: 'CANCEL: the step the customer left at' }) current_step?: string
  @ApiPropertyOptional({ maxLength: 500, description: 'ERROR' }) error_message?: string
  @ApiPropertyOptional({ maxLength: 40, description: 'ERROR (string or number)' }) error_code?: string
  @ApiPropertyOptional({ maxLength: 200, description: 'ERROR' }) session_id?: string
  @ApiPropertyOptional({ description: 'ERROR: Unix milliseconds (string or number)' }) timestamp?: string
}

/** Body of POST /integrations/whatsapp/onboarding-sessions/:sessionId/complete. */
export class CompleteWhatsAppOnboardingDto {
  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: 'The state returned when the session was started' }) state!: string
  @ApiProperty({ enum: EMBEDDED_SIGNUP_EVENTS, enumName: 'EmbeddedSignupEvent' }) event!: EmbeddedSignupEvent
  @ApiPropertyOptional({ maxLength: 2048, description: 'The one-time code from FB.login, sent immediately (it lives about 30 seconds)' })
  code?: string
  @ApiPropertyOptional({ type: EmbeddedSignupSessionInfoDto }) sessionInfo?: EmbeddedSignupSessionInfoDto
}

/** The outcome of an Embedded Signup, written for the admin. Never a token or code. */
export class WhatsAppOnboardingResultDto implements OnboardingResult {
  @ApiProperty({ format: 'uuid' }) sessionId!: string
  @ApiProperty({
    enum: ['exchanged', 'cancelled', 'failed'],
    enumName: 'WhatsAppOnboardingOutcome',
    description: 'exchanged: the token is stored and the number is pending verification',
  })
  status!: 'exchanged' | 'cancelled' | 'failed'
  @ApiProperty({ description: 'What happened and how to recover, for the admin' }) message!: string
  @ApiProperty({ type: [String], description: 'Meta ids of the WhatsApp Business Accounts recorded for the company' }) businessAccountIds!: string[]
  @ApiProperty({ type: [String], description: 'Meta ids of the numbers now pending verification' }) phoneNumberIds!: string[]
}

type SessionInfo = z.infer<typeof embeddedSignupSessionInfoSchema>
// error_code arrives as a string or number and is normalised to a string; timestamp is kept as received.
assertSchemaMatchesDto<Omit<SessionInfo, 'timestamp'>, Omit<EmbeddedSignupSessionInfoDto, 'timestamp'>>(true)
assertSchemaMatchesDto<Omit<z.infer<typeof completeOnboardingBodySchema>, 'sessionInfo'>, Omit<CompleteWhatsAppOnboardingDto, 'sessionInfo'>>(true)
