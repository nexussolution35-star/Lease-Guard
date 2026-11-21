import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { LeaseDocument } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser, CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  CreateLeaseDocumentUploadUrlDto,
  LeaseDocumentDownloadUrlDto,
  LeaseDocumentDto,
  LeaseDocumentUploadUrlDto,
  RegisterLeaseDocumentDto,
} from './dto/lease-document.dto'
import { createLeaseDocumentUploadUrlBodySchema, registerLeaseDocumentBodySchema } from './lease-documents.schemas'
import {
  LEASE_DOCUMENT_DOWNLOAD_SECONDS,
  LeaseDocumentsService,
  MAX_LEASE_DOCUMENTS,
  type LeaseDocumentDownloadUrl,
  type LeaseDocumentUploadUrl,
} from './lease-documents.service'

// CompanyScoped is applied per route (not on the class) so the writer-only routes do not run the company guards twice.
@ApiTags('leases')
@Controller('leases/:leaseId/documents')
export class LeaseDocumentsController {
  constructor(private readonly documents: LeaseDocumentsService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listLeaseDocuments',
    summary: 'List the documents recorded on a lease',
    description: `Newest first, at most ${MAX_LEASE_DOCUMENTS}. Each names its type and the member who uploaded it.`,
  })
  @ApiOkResponse({ type: LeaseDocumentDto, isArray: true })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The lease is not in the active company' })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
  ): Promise<LeaseDocument[]> {
    return this.documents.list(db, company.companyId, leaseId)
  }

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'createLeaseDocumentUploadUrl',
    summary: 'Get a signed URL to upload one lease document PDF (company admins and property managers)',
    description:
      'PDF only, at most 20 MB. The file is stored privately under the active company. Upload it to signedUrl with ' +
      'Content-Type application/pdf, then call registerLeaseDocument with the returned storagePath.',
  })
  @ApiOkResponse({ type: LeaseDocumentUploadUrlDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Not a PDF, or an invalid body' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The lease is not in the active company' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The file is larger than 20 MB' })
  createUploadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
    @Body(new ZodValidationPipe(createLeaseDocumentUploadUrlBodySchema)) body: CreateLeaseDocumentUploadUrlDto,
  ): Promise<LeaseDocumentUploadUrl> {
    return this.documents.createUploadUrl(db, company.companyId, leaseId, body)
  }

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'registerLeaseDocument',
    summary: 'Record an uploaded PDF as a document of the lease (company admins and property managers)',
    description:
      'The stored file must be there, match sizeBytes and be a PDF; its SHA-256 is computed from the stored file. The ' +
      'database records the signed-in user as the uploader and writes the audit entry. A recorded document and its file ' +
      'are kept: they are not replaced or deleted.',
  })
  @ApiCreatedResponse({ type: LeaseDocumentDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'storagePath is not a lease document path of the active company' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The lease is not in the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'This file is already recorded' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'The file is larger than 20 MB' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'File not uploaded, size mismatch, or not a PDF' })
  register(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
    @Body(new ZodValidationPipe(registerLeaseDocumentBodySchema)) body: RegisterLeaseDocumentDto,
  ): Promise<LeaseDocument> {
    return this.documents.register(db, company.companyId, user.userId, leaseId, body)
  }

  @Get(':documentId/download-url')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getLeaseDocumentDownloadUrl',
    summary: `A ${LEASE_DOCUMENT_DOWNLOAD_SECONDS / 60}-minute link to a lease document's file`,
  })
  @ApiOkResponse({ type: LeaseDocumentDownloadUrlDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The document is not on this lease of the active company' })
  downloadUrl(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('leaseId', new ParseUUIDPipe()) leaseId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<LeaseDocumentDownloadUrl> {
    return this.documents.downloadUrl(db, company.companyId, leaseId, documentId)
  }
}
