import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { KnowledgeDocument, KnowledgeEntry, KnowledgeFaq, UserRole, WhatsAppAgentConfig } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  CreateDocumentUploadUrlBodyDto,
  CreateEntryBodyDto,
  CreateFaqBodyDto,
  KnowledgeDocumentDownloadDto,
  KnowledgeDocumentDto,
  KnowledgeDocumentUploadUrlDto,
  KnowledgeEntryDto,
  KnowledgeFaqDto,
  RegisterDocumentBodyDto,
  SaveAgentConfigBodyDto,
  UpdateDocumentBodyDto,
  UpdateEntryBodyDto,
  UpdateFaqBodyDto,
  WhatsAppAgentConfigDto,
} from './dto/whatsapp-agent.dto'
import {
  createDocumentUploadUrlBodySchema,
  createEntryBodySchema,
  createFaqBodySchema,
  registerDocumentBodySchema,
  saveAgentConfigBodySchema,
  updateDocumentBodySchema,
  updateEntryBodySchema,
  updateFaqBodySchema,
} from './whatsapp-agent.schemas'
import { WhatsAppAgentService } from './whatsapp-agent.service'
import { type KnowledgeDocumentUploadUrl, WhatsAppKnowledgeService } from './whatsapp-knowledge.service'

const ADMIN: readonly UserRole[] = ['company_admin']
const REVIEW_NOTE = 'A changed item becomes a draft again until a company admin approves it; only approved items reach the agent.'

/**
 * The active company's AI agent and its knowledge base (ticket 09). Every member reads them; only company admins
 * change them (the role guard answers 403 first, and Row Level Security enforces the same). Tenants are never
 * answered automatically, whatever the configuration says.
 */
@ApiTags('whatsapp-agent')
@Controller('whatsapp/agent')
export class WhatsAppAgentController {
  constructor(
    private readonly agent: WhatsAppAgentService,
    private readonly knowledge: WhatsAppKnowledgeService,
  ) {}

  // ------------------------------------------------------------------ configuration
  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'getWhatsAppAgentConfig', summary: "The active company's AI agent configuration", description: 'The defaults (configured: false) until a company admin saves one.' })
  @ApiOkResponse({ type: WhatsAppAgentConfigDto })
  getConfig(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<WhatsAppAgentConfig> {
    return this.agent.getConfig(db, company.companyId)
  }

  @Put()
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({
    operationId: 'saveWhatsAppAgentConfig',
    summary: "Save the active company's AI agent configuration (company admins)",
    description: 'Replaces the whole configuration and its handover contacts. Auto-reply only ever answers contacts: tenants are never answered automatically.',
  })
  @ApiOkResponse({ type: WhatsAppAgentConfigDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'A handover contact is not an active company admin or property manager of the company' })
  saveConfig(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(saveAgentConfigBodySchema)) body: SaveAgentConfigBodyDto,
  ): Promise<WhatsAppAgentConfig> {
    return this.agent.saveConfig(db, company.companyId, body)
  }

  // ------------------------------------------------------------------ FAQs
  @Get('faqs')
  @CompanyScoped()
  @ApiOperation({ operationId: 'listKnowledgeFaqs', summary: "The active company's FAQs for its agent, drafts included, oldest first" })
  @ApiOkResponse({ type: [KnowledgeFaqDto] })
  listFaqs(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<KnowledgeFaq[]> {
    return this.knowledge.listFaqs(db, company.companyId)
  }

  @Post('faqs')
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({ operationId: 'createKnowledgeFaq', summary: 'Add an FAQ as a draft (company admins)' })
  @ApiCreatedResponse({ type: KnowledgeFaqDto })
  createFaq(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Body(new ZodValidationPipe(createFaqBodySchema)) body: CreateFaqBodyDto): Promise<KnowledgeFaq> {
    return this.knowledge.createFaq(db, company.companyId, body)
  }

  @Patch('faqs/:faqId')
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({ operationId: 'updateKnowledgeFaq', summary: 'Change an FAQ (company admins)', description: REVIEW_NOTE })
  @ApiOkResponse({ type: KnowledgeFaqDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such FAQ in the active company' })
  updateFaq(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('faqId', new ParseUUIDPipe()) faqId: string,
    @Body(new ZodValidationPipe(updateFaqBodySchema)) body: UpdateFaqBodyDto,
  ): Promise<KnowledgeFaq> {
    return this.knowledge.updateFaq(db, company.companyId, faqId, body)
  }

  @Post('faqs/:faqId/approve')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'approveKnowledgeFaq', summary: 'Approve an FAQ for the agent (company admins)', description: 'Records who approved it and when. Repeating it is harmless.' })
  @ApiOkResponse({ type: KnowledgeFaqDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such FAQ in the active company' })
  approveFaq(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('faqId', new ParseUUIDPipe()) faqId: string): Promise<KnowledgeFaq> {
    return this.knowledge.setFaqStatus(db, company.companyId, faqId, 'approved')
  }

  @Post('faqs/:faqId/withdraw')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'withdrawKnowledgeFaq', summary: 'Return an FAQ to draft so the agent stops using it (company admins)' })
  @ApiOkResponse({ type: KnowledgeFaqDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such FAQ in the active company' })
  withdrawFaq(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('faqId', new ParseUUIDPipe()) faqId: string): Promise<KnowledgeFaq> {
    return this.knowledge.setFaqStatus(db, company.companyId, faqId, 'draft')
  }

  @Delete('faqs/:faqId')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteKnowledgeFaq', summary: 'Delete an FAQ (company admins)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such FAQ in the active company' })
  deleteFaq(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('faqId', new ParseUUIDPipe()) faqId: string): Promise<void> {
    return this.knowledge.deleteFaq(db, company.companyId, faqId)
  }

  // ------------------------------------------------------------------ knowledge entries
  @Get('knowledge-entries')
  @CompanyScoped()
  @ApiOperation({ operationId: 'listKnowledgeEntries', summary: "The active company's knowledge entries, drafts included, oldest first" })
  @ApiOkResponse({ type: [KnowledgeEntryDto] })
  listEntries(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<KnowledgeEntry[]> {
    return this.knowledge.listEntries(db, company.companyId)
  }

  @Post('knowledge-entries')
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({ operationId: 'createKnowledgeEntry', summary: 'Add a knowledge entry as a draft (company admins)' })
  @ApiCreatedResponse({ type: KnowledgeEntryDto })
  createEntry(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Body(new ZodValidationPipe(createEntryBodySchema)) body: CreateEntryBodyDto): Promise<KnowledgeEntry> {
    return this.knowledge.createEntry(db, company.companyId, body)
  }

  @Patch('knowledge-entries/:entryId')
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({ operationId: 'updateKnowledgeEntry', summary: 'Change a knowledge entry (company admins)', description: REVIEW_NOTE })
  @ApiOkResponse({ type: KnowledgeEntryDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such entry in the active company' })
  updateEntry(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body(new ZodValidationPipe(updateEntryBodySchema)) body: UpdateEntryBodyDto,
  ): Promise<KnowledgeEntry> {
    return this.knowledge.updateEntry(db, company.companyId, entryId, body)
  }

  @Post('knowledge-entries/:entryId/approve')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'approveKnowledgeEntry', summary: 'Approve a knowledge entry for the agent (company admins)' })
  @ApiOkResponse({ type: KnowledgeEntryDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such entry in the active company' })
  approveEntry(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('entryId', new ParseUUIDPipe()) entryId: string): Promise<KnowledgeEntry> {
    return this.knowledge.setEntryStatus(db, company.companyId, entryId, 'approved')
  }

  @Post('knowledge-entries/:entryId/withdraw')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'withdrawKnowledgeEntry', summary: 'Return a knowledge entry to draft (company admins)' })
  @ApiOkResponse({ type: KnowledgeEntryDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such entry in the active company' })
  withdrawEntry(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('entryId', new ParseUUIDPipe()) entryId: string): Promise<KnowledgeEntry> {
    return this.knowledge.setEntryStatus(db, company.companyId, entryId, 'draft')
  }

  @Delete('knowledge-entries/:entryId')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteKnowledgeEntry', summary: 'Delete a knowledge entry (company admins)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such entry in the active company' })
  deleteEntry(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('entryId', new ParseUUIDPipe()) entryId: string): Promise<void> {
    return this.knowledge.deleteEntry(db, company.companyId, entryId)
  }

  // ------------------------------------------------------------------ documents
  @Get('documents')
  @CompanyScoped()
  @ApiOperation({ operationId: 'listKnowledgeDocuments', summary: "The active company's knowledge documents, drafts included, oldest first" })
  @ApiOkResponse({ type: [KnowledgeDocumentDto] })
  listDocuments(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<KnowledgeDocument[]> {
    return this.knowledge.listDocuments(db, company.companyId)
  }

  @Post('documents/upload-url')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'createKnowledgeDocumentUploadUrl',
    summary: 'Get a signed URL to upload one knowledge document (company admins)',
    description: 'PDF, PNG, JPEG or plain text, at most 10 MB. Upload the file to signedUrl, then call registerKnowledgeDocument with the returned storagePath.',
  })
  @ApiOkResponse({ type: KnowledgeDocumentUploadUrlDto })
  createDocumentUploadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createDocumentUploadUrlBodySchema)) body: CreateDocumentUploadUrlBodyDto,
  ): Promise<KnowledgeDocumentUploadUrl> {
    return this.knowledge.createDocumentUploadUrl(db, company.companyId, body)
  }

  @Post('documents')
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({ operationId: 'registerKnowledgeDocument', summary: 'Register an uploaded file as a draft knowledge document (company admins)' })
  @ApiCreatedResponse({ type: KnowledgeDocumentDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The file is not uploaded, or its size differs' })
  registerDocument(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(registerDocumentBodySchema)) body: RegisterDocumentBodyDto,
  ): Promise<KnowledgeDocument> {
    return this.knowledge.registerDocument(db, company.companyId, body)
  }

  @Patch('documents/:documentId')
  @CompanyScoped({ roles: ADMIN })
  @ApiOperation({ operationId: 'updateKnowledgeDocument', summary: "Change a knowledge document's title or description (company admins)", description: REVIEW_NOTE })
  @ApiOkResponse({ type: KnowledgeDocumentDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such document in the active company' })
  updateDocument(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body(new ZodValidationPipe(updateDocumentBodySchema)) body: UpdateDocumentBodyDto,
  ): Promise<KnowledgeDocument> {
    return this.knowledge.updateDocument(db, company.companyId, documentId, body)
  }

  @Post('documents/:documentId/approve')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'approveKnowledgeDocument', summary: 'Approve a knowledge document for the agent (company admins)' })
  @ApiOkResponse({ type: KnowledgeDocumentDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such document in the active company' })
  approveDocument(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('documentId', new ParseUUIDPipe()) documentId: string): Promise<KnowledgeDocument> {
    return this.knowledge.setDocumentStatus(db, company.companyId, documentId, 'approved')
  }

  @Post('documents/:documentId/withdraw')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'withdrawKnowledgeDocument', summary: 'Return a knowledge document to draft (company admins)' })
  @ApiOkResponse({ type: KnowledgeDocumentDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such document in the active company' })
  withdrawDocument(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('documentId', new ParseUUIDPipe()) documentId: string): Promise<KnowledgeDocument> {
    return this.knowledge.setDocumentStatus(db, company.companyId, documentId, 'draft')
  }

  @Get('documents/:documentId/download-url')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getKnowledgeDocumentDownloadUrl', summary: "A five-minute link to a knowledge document's file" })
  @ApiOkResponse({ type: KnowledgeDocumentDownloadDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such document (or file) in the active company' })
  documentDownloadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<KnowledgeDocumentDownloadDto> {
    return this.knowledge.documentDownloadUrl(db, company.companyId, documentId)
  }

  @Delete('documents/:documentId')
  @CompanyScoped({ roles: ADMIN })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteKnowledgeDocument', summary: 'Delete a knowledge document and its file (company admins)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such document in the active company' })
  deleteDocument(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext, @Param('documentId', new ParseUUIDPipe()) documentId: string): Promise<void> {
    return this.knowledge.deleteDocument(db, company.companyId, documentId)
  }
}
