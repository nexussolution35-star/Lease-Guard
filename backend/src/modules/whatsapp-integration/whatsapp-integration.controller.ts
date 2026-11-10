import { Controller, Get, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { WhatsAppBusinessAccount } from '@leaseguard/domain'

import { Authenticated, CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import type { CompanyContext } from '../../common/request-context'
import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { WorkerCapabilitiesReader } from '../../infrastructure/capabilities/worker-capabilities.reader'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { WhatsAppBusinessAccountDto, WhatsAppCapabilitiesDto } from './dto/whatsapp-integration.dto'
import { type WhatsAppCapabilities, whatsAppCapabilities } from './whatsapp-capabilities'
import { WhatsAppIntegrationService } from './whatsapp-integration.service'

/**
 * Settings → Integrations → WhatsApp: what this deployment is configured for, and the active company's
 * WhatsApp Business Accounts and numbers with their verified status. Read-only.
 */
@ApiTags('whatsapp-integration')
@Controller('integrations/whatsapp')
export class WhatsAppIntegrationController {
  constructor(
    private readonly integration: WhatsAppIntegrationService,
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
}
