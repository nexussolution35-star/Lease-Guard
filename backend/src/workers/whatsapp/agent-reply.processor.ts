import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import type { AgentLlm } from '../../messaging/agent-llm'
import { DatabaseAgentRunStore } from '../../messaging/agent-run-store'
import { type AgentRunResult, runAgent } from '../../messaging/agent-runtime'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { WorkerQueues } from '../queues/worker-queues'
import { Clock } from '../shared/clock'

/** Injection token of the agent's model: the Anthropic adapter, or null when the worker has no ANTHROPIC_API_KEY. */
export const AGENT_LLM = Symbol('AGENT_LLM')

/**
 * Queue `whatsapp-agent`: the company's AI agent on one inbound WhatsApp message (messaging/agent-runtime.ts). A reply
 * the run created is queued for the delivery worker (`message-delivery`), which sends it through the outbound gate,
 * the lifecycle and the company's channel. A model failure that may pass (rate limit, overload) is retried by the job;
 * after its last attempt the conversation is handed to a person. Never logs message text.
 */
@Injectable()
export class WhatsAppAgentProcessor implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppAgentProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly queues: WorkerQueues,
    private readonly clock: Clock,
    @Inject(AGENT_LLM) private readonly llm: AgentLlm | null,
  ) {}

  onModuleInit(): void {
    this.runtime.start('whatsapp-agent', (payload, attempt) => this.process(payload, attempt), { concurrency: 4 })
  }

  async process(job: JobPayloads['whatsapp-agent'], attempt: JobAttempt): Promise<AgentRunResult> {
    const result = await runAgent(
      {
        store: new DatabaseAgentRunStore(this.clients.get()),
        llm: this.llm,
        deliver: async (message) => {
          await this.queues.enqueueAll('message-delivery', [message])
        },
        now: () => this.clock.now(),
      },
      job,
      { finalAttempt: isFinalAttempt(attempt) },
    )
    this.logger.log({ companyId: job.companyId, communicationId: job.communicationId, ...result }, 'WhatsApp agent run')
    return result
  }
}
