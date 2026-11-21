import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { Clock } from '../shared/clock'
import { DatabaseVerificationStore } from './number-verification.processor'
import { syncNumberTemplates, type TemplateSyncOutcome } from './template-sync'

/** Queue `whatsapp-template-sync`: syncs one connected number's message templates from Meta (template-sync.ts). */
@Injectable()
export class WhatsAppTemplateSyncProcessor implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppTemplateSyncProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly channels: WhatsAppChannels,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.runtime.start('whatsapp-template-sync', (payload, attempt) => this.process(payload, attempt), { concurrency: 2 })
  }

  async process(job: JobPayloads['whatsapp-template-sync'], attempt: JobAttempt): Promise<TemplateSyncOutcome> {
    // The verification store's template sync: the same database function as step 5 of number verification.
    const store = new DatabaseVerificationStore(this.clients.get(), () => this.clock.now())
    const result = await syncNumberTemplates(job, { finalAttempt: isFinalAttempt(attempt) }, { channels: this.channels, store })
    this.logger.log({ companyId: job.companyId, numberId: job.numberId, ...result }, 'WhatsApp message templates synced')
    return result
  }
}
