import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { WhatsAppBusinessAccount } from '@leaseguard/domain'

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
import { WhatsAppBusinessAccountDto, WhatsAppCapabilitiesDto } from './dto/whatsapp-integration.dto'
import { CompleteWhatsAppOnboardingDto, WhatsAppOnboardingResultDto, WhatsAppOnboardingSessionDto } from './dto/whatsapp-onboarding.dto'
import { type WhatsAppCapabilities, whatsAppCapabilities } from './whatsapp-capabilities'
import { WhatsAppIntegrationService } from './whatsapp-integration.service'
import { completeOnboardingBodySchema } from './whatsapp-onboarding.schemas'
import { type OnboardingResult, type OnboardingSessionStart, WhatsAppOnboardingService } from './whatsapp-onboarding.service'

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
}
