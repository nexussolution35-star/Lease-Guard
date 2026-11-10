import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  AGENT_LANGUAGES,
  AGENT_PERMITTED_ACTIONS,
  type AgentHandoverContact,
  type AgentLanguage,
  type AgentOperatingPeriod,
  type AgentPermittedAction,
  KNOWLEDGE_DOCUMENT_MIME_TYPES,
  KNOWLEDGE_STATUSES,
  type KnowledgeDocument,
  type KnowledgeDocumentMimeType,
  type KnowledgeEntry,
  type KnowledgeFaq,
  type KnowledgeStatus,
  type Weekday,
  WEEKDAYS,
  type WhatsAppAgentConfig,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type {
  createDocumentUploadUrlBodySchema,
  createEntryBodySchema,
  createFaqBodySchema,
  registerDocumentBodySchema,
  saveAgentConfigBodySchema,
  updateDocumentBodySchema,
  updateEntryBodySchema,
  updateFaqBodySchema,
} from '../whatsapp-agent.schemas'
import type { KnowledgeDocumentUploadUrl } from '../whatsapp-knowledge.service'

const ACTION_DESCRIPTION =
  'answer_faq: answer from approved FAQs; share_business_info: share the business description, hours and approved entries; ' +
  'share_approved_document: refer contacts to an approved document; capture_enquiry: take down an enquiry for staff; ' +
  'draft_tenant_reply: draft an internal suggestion for staff when a tenant writes (never sent to the tenant).'

export class AgentOperatingPeriodDto implements AgentOperatingPeriod {
  @ApiProperty({ enum: WEEKDAYS, enumName: 'Weekday' }) day!: Weekday
  @ApiProperty({ example: '08:00', description: 'HH:mm, 24-hour, in the agent timezone' }) opens!: string
  @ApiProperty({ example: '17:00', description: 'HH:mm, 24-hour; 24:00 for midnight; after opens' }) closes!: string
}

export class AgentHandoverContactDto implements AgentHandoverContact {
  @ApiProperty({ format: 'uuid' }) userId!: string
  @ApiPropertyOptional() name?: string
}

/** The company's AI agent settings. Same shape as the domain `WhatsAppAgentConfig`. */
export class WhatsAppAgentConfigDto implements WhatsAppAgentConfig {
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ description: 'False until a company admin saves the configuration; the defaults are returned until then' }) configured!: boolean
  @ApiProperty() agentName!: string
  @ApiProperty() businessDescription!: string
  @ApiProperty() tone!: string
  @ApiProperty({ example: 'Africa/Johannesburg' }) timezone!: string
  @ApiProperty({ type: [AgentOperatingPeriodDto], description: 'Empty: never open' }) operatingHours!: AgentOperatingPeriodDto[]
  @ApiProperty({ enum: AGENT_LANGUAGES, enumName: 'AgentLanguage', isArray: true }) languages!: AgentLanguage[]
  @ApiProperty() policies!: string
  @ApiProperty() supportInstructions!: string
  @ApiProperty() escalationRules!: string
  @ApiProperty({ enum: AGENT_PERMITTED_ACTIONS, enumName: 'AgentPermittedAction', isArray: true, description: ACTION_DESCRIPTION })
  permittedActions!: AgentPermittedAction[]
  @ApiProperty({ description: 'Whether the agent may answer contacts on its own. Tenants are never answered automatically.' }) autoReplyEnabled!: boolean
  @ApiPropertyOptional() outOfHoursMessage?: string
  @ApiProperty({ type: [AgentHandoverContactDto] }) handoverContacts!: AgentHandoverContactDto[]
  @ApiPropertyOptional({ format: 'date-time' }) updatedAt?: string
  @ApiPropertyOptional({ format: 'uuid' }) updatedByUserId?: string
}

export class SaveAgentConfigBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 80 }) agentName!: string
  @ApiProperty({ maxLength: 4000 }) businessDescription!: string
  @ApiProperty({ maxLength: 500 }) tone!: string
  @ApiProperty({ example: 'Africa/Johannesburg' }) timezone!: string
  @ApiProperty({ type: [AgentOperatingPeriodDto], maxItems: 14, description: 'No overlapping periods on a day' }) operatingHours!: AgentOperatingPeriodDto[]
  @ApiProperty({ enum: AGENT_LANGUAGES, enumName: 'AgentLanguage', isArray: true, minItems: 1 }) languages!: AgentLanguage[]
  @ApiProperty({ maxLength: 8000 }) policies!: string
  @ApiProperty({ maxLength: 8000 }) supportInstructions!: string
  @ApiProperty({ maxLength: 8000 }) escalationRules!: string
  @ApiProperty({ enum: AGENT_PERMITTED_ACTIONS, enumName: 'AgentPermittedAction', isArray: true, description: ACTION_DESCRIPTION })
  permittedActions!: AgentPermittedAction[]
  @ApiProperty() autoReplyEnabled!: boolean
  @ApiPropertyOptional({ maxLength: 1000, description: 'Sent once per customer service window outside operating hours; empty for none' }) outOfHoursMessage?: string
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 20, description: 'Active company admins or property managers of the company' })
  handoverContactUserIds!: string[]
}
assertSchemaMatchesDto<z.infer<typeof saveAgentConfigBodySchema>, SaveAgentConfigBodyDto>(true)

abstract class KnowledgeReviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) companyId!: string
  @ApiProperty({ enum: KNOWLEDGE_STATUSES, enumName: 'KnowledgeStatus', description: 'Only approved items are available to the agent' }) status!: KnowledgeStatus
  @ApiPropertyOptional({ format: 'date-time' }) approvedAt?: string
  @ApiPropertyOptional({ format: 'uuid' }) approvedByUserId?: string
  @ApiPropertyOptional() approvedByName?: string
  @ApiPropertyOptional({ format: 'uuid' }) createdByUserId?: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
}

export class KnowledgeFaqDto extends KnowledgeReviewDto implements KnowledgeFaq {
  @ApiProperty() question!: string
  @ApiProperty() answer!: string
}

export class KnowledgeEntryDto extends KnowledgeReviewDto implements KnowledgeEntry {
  @ApiProperty() title!: string
  @ApiProperty() content!: string
}

export class KnowledgeDocumentDto extends KnowledgeReviewDto implements KnowledgeDocument {
  @ApiProperty() title!: string
  @ApiPropertyOptional() description?: string
  @ApiProperty() fileName!: string
  @ApiProperty({ enum: KNOWLEDGE_DOCUMENT_MIME_TYPES, enumName: 'KnowledgeDocumentMimeType' }) mimeType!: KnowledgeDocumentMimeType
  @ApiProperty() sizeBytes!: number
}

export class CreateFaqBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) question!: string
  @ApiProperty({ minLength: 1, maxLength: 4000 }) answer!: string
}
assertSchemaMatchesDto<z.infer<typeof createFaqBodySchema>, CreateFaqBodyDto>(true)

export class UpdateFaqBodyDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 500 }) question?: string
  @ApiPropertyOptional({ minLength: 1, maxLength: 4000 }) answer?: string
}
assertSchemaMatchesDto<z.infer<typeof updateFaqBodySchema>, UpdateFaqBodyDto>(true)

export class CreateEntryBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 200 }) title!: string
  @ApiProperty({ minLength: 1, maxLength: 10000 }) content!: string
}
assertSchemaMatchesDto<z.infer<typeof createEntryBodySchema>, CreateEntryBodyDto>(true)

export class UpdateEntryBodyDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 }) title?: string
  @ApiPropertyOptional({ minLength: 1, maxLength: 10000 }) content?: string
}
assertSchemaMatchesDto<z.infer<typeof updateEntryBodySchema>, UpdateEntryBodyDto>(true)

export class CreateDocumentUploadUrlBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 255, example: 'leasing-brochure.pdf' }) fileName!: string
  @ApiProperty({ enum: KNOWLEDGE_DOCUMENT_MIME_TYPES, enumName: 'KnowledgeDocumentMimeType' }) mimeType!: KnowledgeDocumentMimeType
  @ApiProperty({ minimum: 1, maximum: 10485760, description: 'Bytes; at most 10 MB' }) sizeBytes!: number
}
assertSchemaMatchesDto<z.infer<typeof createDocumentUploadUrlBodySchema>, CreateDocumentUploadUrlBodyDto>(true)

export class KnowledgeDocumentUploadUrlDto implements KnowledgeDocumentUploadUrl {
  @ApiProperty({ format: 'uuid', description: 'Id the document will have once registered' }) documentId!: string
  @ApiProperty({ description: 'Pass unchanged to registerKnowledgeDocument: <companyId>/<documentId>/<file>' }) storagePath!: string
  @ApiProperty({ description: 'Upload the file here with PUT, or with supabase-js uploadToSignedUrl(storagePath, token, file)' }) signedUrl!: string
  @ApiProperty({ description: 'Upload token embedded in signedUrl' }) token!: string
  @ApiProperty() maxSizeBytes!: number
}

export class RegisterDocumentBodyDto extends CreateDocumentUploadUrlBodyDto {
  @ApiProperty({ description: 'The storagePath createKnowledgeDocumentUploadUrl returned' }) storagePath!: string
  @ApiProperty({ minLength: 1, maxLength: 200 }) title!: string
  @ApiPropertyOptional({ maxLength: 1000 }) description?: string
}
assertSchemaMatchesDto<z.infer<typeof registerDocumentBodySchema>, RegisterDocumentBodyDto>(true)

export class UpdateDocumentBodyDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 }) title?: string
  @ApiPropertyOptional({ maxLength: 1000 }) description?: string
}
assertSchemaMatchesDto<z.infer<typeof updateDocumentBodySchema>, UpdateDocumentBodyDto>(true)

export class KnowledgeDocumentDownloadDto {
  @ApiProperty({ description: 'A short-lived link to the file' }) url!: string
  @ApiProperty() expiresInSeconds!: number
}
