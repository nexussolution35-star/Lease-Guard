import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiTooManyRequestsResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { WhatsAppActivation, WhatsAppBusinessAccount, WhatsAppMessageTemplate, WhatsAppSetup, WhatsAppTestMessage } from '@leaseguard/domain'

import { Authenticated, CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { WorkerCapabilitiesReader } from '../../infrastructure/capabilities/worker-capabilities.reader'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  RegisterWhatsAppNumberDto,
  WhatsAppBusinessAccountDto,
  WhatsAppCapabilitiesDto,
  WhatsAppDisconnectResultDto,
  WhatsAppMessageTemplateDto,
  WhatsAppVerificationRequestDto,
} from './dto/whatsapp-integration.dto'
import { CompleteWhatsAppOnboardingDto, WhatsAppOnboardingResultDto, WhatsAppOnboardingSessionDto } from './dto/whatsapp-onboarding.dto'
import { type WhatsAppCapabilities, whatsAppCapabilities } from './whatsapp-capabilities'
import { WhatsAppIntegrationService } from './whatsapp-integration.service'
import { type DisconnectResult, type VerificationRequest, WhatsAppNumbersService } from './whatsapp-numbers.service'
import { SendWhatsAppTestMessageDto, WhatsAppActivationDto, WhatsAppSetupDto, WhatsAppTestMessageDto } from './dto/whatsapp-setup.dto'
import { completeOnboardingBodySchema, registerNumberBodySchema, sendTestMessageBodySchema } from './whatsapp-onboarding.schemas'
import { type OnboardingResult, type OnboardingSessionStart, WhatsAppOnboardingService } from './whatsapp-onboarding.service'
import { WhatsAppSetupService } from './whatsapp-setup.service'

/**
 * Settings → Integrations → WhatsApp: what this deployment is configured for, and the active company's
 * WhatsApp Business Accounts and numbers with their verified status, and Meta Embedded Signup (company admins).
 */
@ApiTags('whatsapp-integration')
@Controller('integrations/whatsapp')
export class WhatsAppIntegrationController {
  constructor(
    private readonly integration: WhatsAppIntegrationService,
    private readonly onboarding: WhatsAppOnboardingService,
    private readonly numbers: WhatsAppNumbersService,
    private readonly setup: WhatsAppSetupService,
    private readonly worker: WorkerCapabilitiesReader,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('capabilities')
  @Authenticated()
  @ApiOperation({
    operationId: 'getWhatsAppCapabilities',
    summary: 'Whether Embedded Signup, the webhook and the AI agent runtime are configured',
    description:
      'Public-safe: flags, the public Meta app and Embedded Signup configuration ids, and the names (never values) of ' +
      'missing settings with the process that reads each. Configured here does not mean Meta has approved the app; ' +
      'Meta Business Verification, App Review and Advanced Access are outside LeaseGuard and not reported.',
  })
  @ApiOkResponse({ type: WhatsAppCapabilitiesDto })
  async capabilities(): Promise<WhatsAppCapabilities> {
    return whatsAppCapabilities(this.env, await this.worker.read())
  }

  @Get('business-accounts')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listWhatsAppBusinessAccounts',
    summary: "The active company's WhatsApp Business Accounts with their numbers and status",
    description: 'Every member of the company may read them. Statuses are recorded by LeaseGuard after verifying with Meta.',
  })
  @ApiOkResponse({ type: [WhatsAppBusinessAccountDto] })
  listBusinessAccounts(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<WhatsAppBusinessAccount[]> {
    return this.integration.listBusinessAccounts(db, company.companyId)
  }

  @Post('onboarding-sessions')
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'startWhatsAppOnboarding',
    summary: 'Start connecting WhatsApp Business through Meta Embedded Signup (company admins)',
    description:
      'Creates a single-use signup session for the caller and the active company, valid for 15 minutes; an earlier ' +
      "unfinished session of the same admin expires. Returns what the browser passes to Meta's Facebook JavaScript SDK " +
      '(public app and configuration ids, Graph API version, Embedded Signup v5 extras) and the state to send back. ' +
      '503 while Embedded Signup is not configured on the API.',
  })
  @ApiCreatedResponse({ type: WhatsAppOnboardingSessionDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Embedded Signup is not configured, or the database is unavailable' })
  startOnboarding(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<OnboardingSessionStart> {
    return this.onboarding.start(db, company.companyId)
  }

  @Post('onboarding-sessions/:sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'completeWhatsAppOnboarding',
    summary: "Record Meta Embedded Signup's result and exchange its code (the admin who started the session)",
    description:
      "Send the WA_EMBEDDED_SIGNUP message's event and data, and the code from FB.login, as soon as the popup returns: " +
      'the code lives about 30 seconds. A finish with a code is exchanged with Meta server to server; the business token ' +
      "is stored in Supabase Vault for the company and never returned, and the shared number appears pending verification. " +
      'CANCEL, ERROR and a finish without a code are recorded, and the response explains how to recover. A session is ' +
      'single-use and belongs to the admin and company that started it (404 for anyone else).',
  })
  @ApiOkResponse({ type: WhatsAppOnboardingResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such session of the caller in the active company, or a wrong state' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The session was already used, or expired' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Embedded Signup is not configured, or the database is unavailable' })
  completeOnboarding(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body(new ZodValidationPipe(completeOnboardingBodySchema)) body: CompleteWhatsAppOnboardingDto,
  ): Promise<OnboardingResult> {
    return this.onboarding.complete(db, company.companyId, sessionId, completeOnboardingBodySchema.parse(body))
  }

  @Get('message-templates')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listWhatsAppMessageTemplates',
    summary: "The message templates Meta holds for the active company's WhatsApp Business Accounts",
    description: "As last synced during number verification: name, language, Meta's category and review status. Every member may read them.",
  })
  @ApiOkResponse({ type: [WhatsAppMessageTemplateDto] })
  listMessageTemplates(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<WhatsAppMessageTemplate[]> {
    return this.numbers.listTemplates(db, company.companyId)
  }

  @Post('numbers/:numberId/verify')
  @HttpCode(HttpStatus.ACCEPTED)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'verifyWhatsAppNumber',
    summary: 'Verify a number with Meta again (company admins)',
    description:
      'Queues the verification of the number in the worker: token scopes, the number in its account, the webhook subscription, ' +
      'registration and the template sync. The number is connected only when every step passes; the business accounts list shows ' +
      'each step. Idempotent: a run already waiting or in progress is not duplicated.',
  })
  @ApiAcceptedResponse({ type: WhatsAppVerificationRequestDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such number in the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The number was disconnected' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Background processing is unavailable' })
  verifyNumber(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('numberId', new ParseUUIDPipe()) numberId: string,
  ): Promise<VerificationRequest> {
    return this.numbers.verify(db, company.companyId, numberId)
  }

  @Post('numbers/:numberId/register')
  @HttpCode(HttpStatus.ACCEPTED)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'registerWhatsAppNumber',
    summary: 'Register a number for the WhatsApp Cloud API with a 6-digit PIN (company admins)',
    description:
      "The PIN becomes (or must match) the number's two-step verification PIN. It is handed to the worker for one attempt and " +
      "is never stored or logged. Meta allows 10 attempts per 72 hours: after its rate-limit error (133016) further attempts " +
      'are refused with 429 until the lock ends, so no request reaches Meta.',
  })
  @ApiAcceptedResponse({ type: WhatsAppVerificationRequestDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such number in the active company' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The number is already connected or was disconnected, or a verification run is in progress (the PIN is not stored)' })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto, description: "Meta's registration lock is in effect" })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Background processing is unavailable' })
  registerNumber(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('numberId', new ParseUUIDPipe()) numberId: string,
    @Body(new ZodValidationPipe(registerNumberBodySchema)) body: RegisterWhatsAppNumberDto,
  ): Promise<VerificationRequest> {
    return this.numbers.register(db, company.companyId, numberId, registerNumberBodySchema.parse(body).pin)
  }

  @Post('numbers/:numberId/disconnect')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'disconnectWhatsAppNumber',
    summary: 'Disconnect a number (company admins)',
    description:
      'The number stops sending and receiving at once and is marked disconnected; its stored business token is deleted from ' +
      'Vault unless another number of the company in use still holds it. LeaseGuard stays installed in Meta until the business ' +
      'removes it in Meta Business Settings.',
  })
  @ApiOkResponse({ type: WhatsAppDisconnectResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such number in the active company' })
  disconnectNumber(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('numberId', new ParseUUIDPipe()) numberId: string,
  ): Promise<DisconnectResult> {
    return this.numbers.disconnect(db, company.companyId, numberId)
  }

  @Get('setup')
  @CompanyScoped()
  @ApiOperation({
    operationId: 'getWhatsAppSetup',
    summary: "The active company's ten WhatsApp setup steps and its activation",
    description:
      "Each step is done only when LeaseGuard verified it (Meta's answers recorded during signup and number verification, " +
      "Meta's delivered or read status of a test message, LeaseGuard's own records), with what to do next. Every member may " +
      'read it; the latest test message is included for company admins only.',
  })
  @ApiOkResponse({ type: WhatsAppSetupDto })
  getSetup(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<WhatsAppSetup> {
    return this.setup.status(db, company)
  }

  @Post('test-messages')
  @HttpCode(HttpStatus.ACCEPTED)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'sendWhatsAppTestMessage',
    summary: 'Send a test message from a connected number (company admins)',
    description:
      "Sends an approved Meta template of the number's account, without parameters, to the number entered (never a tenant of " +
      "the company). The worker sends it; the setup step completes only when Meta reports it delivered or read. At most 10 per " +
      'company per hour.',
  })
  @ApiAcceptedResponse({ type: WhatsAppTestMessageDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "No such number, or no such template in the number's account" })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The number is not connected' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: "The template is not approved by Meta, or the number is a tenant's" })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto, description: '10 test messages in the last hour' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Background processing is unavailable (the test message is marked failed)' })
  sendTestMessage(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(sendTestMessageBodySchema)) body: SendWhatsAppTestMessageDto,
  ): Promise<WhatsAppTestMessage> {
    return this.setup.sendTestMessage(db, company.companyId, sendTestMessageBodySchema.parse(body))
  }

  @Post('activation')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({
    operationId: 'activateWhatsApp',
    summary: 'Activate WhatsApp for the company (company admins)',
    description: 'Refused with 409 until every required setup step is verified; the database refuses it too, whoever asks.',
  })
  @ApiOkResponse({ type: WhatsAppActivationDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'A required setup step is not verified' })
  activate(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<WhatsAppActivation> {
    return this.setup.activate(db, company.companyId)
  }

  @Delete('activation')
  @CompanyScoped({ roles: ['company_admin'] })
  @ApiOperation({ operationId: 'deactivateWhatsApp', summary: 'Mark WhatsApp as not active for the company (company admins)' })
  @ApiOkResponse({ type: WhatsAppActivationDto })
  deactivate(@UserDb() db: DbClient, @CurrentCompany() company: CompanyContext): Promise<WhatsAppActivation> {
    return this.setup.deactivate(db, company.companyId)
  }
}
