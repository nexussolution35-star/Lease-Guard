import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { sendTestMessage, type TestMessageOutcome } from './test-message'
import { DatabaseTestMessageStore } from './test-message-store'

/** Queue `whatsapp-test-message`: sends one company admin's test message (test-message.ts). */
@Injectable()
export class WhatsAppTestMessageProcessor implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppTestMessageProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly channels: WhatsAppChannels,
  ) {}

  onModuleInit(): void {
    this.runtime.start('whatsapp-test-message', (payload, attempt) => this.process(payload, attempt), { concurrency: 2 })
  }

  async process(job: JobPayloads['whatsapp-test-message'], attempt: JobAttempt): Promise<TestMessageOutcome> {
    const result = await sendTestMessage(
      { store: new DatabaseTestMessageStore(this.clients.get()), channels: this.channels },
      job,
      { finalAttempt: isFinalAttempt(attempt) },
    )
    this.logger.log({ companyId: job.companyId, testMessageId: job.testMessageId, outcome: result.outcome }, 'WhatsApp test message')
    return result
  }
}
