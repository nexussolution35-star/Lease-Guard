import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  WHATSAPP_SETUP_STATES,
  WHATSAPP_SETUP_STEPS,
  WHATSAPP_TEST_MESSAGE_STATUSES,
  type WhatsAppActivation,
  type WhatsAppSetup,
  type WhatsAppSetupState,
  type WhatsAppSetupStep,
  type WhatsAppSetupStepStatus,
  type WhatsAppTestMessage,
  type WhatsAppTestMessageStatus,
} from '@leaseguard/domain'

/** One WhatsApp setup step, computed from facts LeaseGuard verified. */
export class WhatsAppSetupStepDto implements WhatsAppSetupStepStatus {
  @ApiProperty({ enum: WHATSAPP_SETUP_STEPS, enumName: 'WhatsAppSetupStep' }) step!: WhatsAppSetupStep
  @ApiProperty({ description: 'Required for activation (the AI agent and knowledge base are recommended only)' }) required!: boolean
  @ApiProperty({
    enum: WHATSAPP_SETUP_STATES,
    enumName: 'WhatsAppSetupState',
    description: 'done: verified; action_needed: a company admin acts next; waiting_on_meta: LeaseGuard waits for Meta; blocked: an earlier step first',
  })
  state!: WhatsAppSetupState
  @ApiProperty() title!: string
  @ApiProperty({ description: 'What is verified, or what to do next' }) guidance!: string
}

export class WhatsAppActivationDto implements WhatsAppActivation {
  @ApiProperty() active!: boolean
  @ApiPropertyOptional({ format: 'date-time' }) activatedAt?: string
  @ApiPropertyOptional({ format: 'uuid' }) activatedByUserId?: string
}

export class WhatsAppTestMessageDto implements WhatsAppTestMessage {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid', description: 'The company number it is sent from' }) numberId!: string
  @ApiProperty({ description: "Meta's template name" }) templateName!: string
  @ApiProperty({ description: 'Meta language code, e.g. en_ZA' }) templateLanguage!: string
  @ApiProperty({ description: 'E.164 recipient; never a tenant of the company' }) toNumber!: string
  @ApiProperty({
    enum: WHATSAPP_TEST_MESSAGE_STATUSES,
    enumName: 'WhatsAppTestMessageStatus',
    description: "Only delivered or read (Meta's status webhook) completes the setup step",
  })
  status!: WhatsAppTestMessageStatus
  @ApiPropertyOptional({ description: "Why it failed (Meta's code and title, or LeaseGuard's reason)" }) failureReason?: string
  @ApiProperty({ description: 'The outcome of the send is unknown; check the phone before sending another' }) mayHaveBeenSent!: boolean
  @ApiPropertyOptional({ format: 'uuid' }) requestedByUserId?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiPropertyOptional({ format: 'date-time' }) sentAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) deliveredAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) readAt?: string
  @ApiPropertyOptional({ format: 'date-time' }) failedAt?: string
}

export class WhatsAppSetupDto implements WhatsAppSetup {
  @ApiProperty({ type: [WhatsAppSetupStepDto], description: 'The ten steps, in order' }) steps!: WhatsAppSetupStepDto[]
  @ApiProperty() completedSteps!: number
  @ApiProperty() totalSteps!: number
  @ApiProperty({ description: 'Every required step is verified; a company admin may activate WhatsApp' }) readyForActivation!: boolean
  @ApiProperty({ type: WhatsAppActivationDto }) activation!: WhatsAppActivationDto
  @ApiPropertyOptional({ type: WhatsAppTestMessageDto, description: 'The latest test message (company admins only)' })
  latestTestMessage?: WhatsAppTestMessageDto
}

export class SendWhatsAppTestMessageDto {
  @ApiProperty({ format: 'uuid', description: 'A connected number of the company' }) numberId!: string
  @ApiProperty({ format: 'uuid', description: "An APPROVED template of the number's WhatsApp Business Account (from message-templates)" })
  templateId!: string
  @ApiProperty({ description: 'Recipient in international format; not a tenant of the company', pattern: '^\\+[1-9][0-9]{7,14}$', example: '+27821234567' })
  to!: string
}
