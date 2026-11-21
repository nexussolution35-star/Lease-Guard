import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { MissingTemplateVariablesError, ownerSummaryMessage, type EntityId } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { ProcessorRuntime } from '../jobs/processor-runtime'
import { WorkerQueues } from '../queues/worker-queues'
import { unwrap } from '../shared/db'

export type OwnerSummaryDeliveryResult =
  | { outcome: 'queued'; communicationId: EntityId; recorded: 'created' | 'existing' }
  | { outcome: 'blocked'; reason: string }

/**
 * The core messaging pipeline's side of the weekly owner summary (ticket R-07, ADR 0003). The reports service's worker
 * computes and stores each property owner's summary and enqueues `owner-summary-delivery`; this processor:
 *
 * 1. reads the stored summary through the reports service's read-only function (`reports_owner_summary_message`): the
 *    owner, the week and the template values;
 * 2. fills the text of the template a company admin chose for owner_weekly_summary (Settings → Message templates);
 * 3. records it as an approved owner_weekly_summary communication (`record_owner_weekly_summary_message`: once per
 *    owner and week, approved by the schedule, never to a tenant, and only with an approved template, a connected number
 *    and an owner with a WhatsApp number; otherwise nothing is created and the reason is returned);
 * 4. hands it to `message-delivery`, which applies the outbound gate, claims, sends through the company's own number
 *    and records the delivery status like every other message.
 *
 * Safe to repeat: the message is recorded once per owner and week and the delivery job id is the message's.
 */
@Injectable()
export class OwnerSummaryDeliveryProcessor implements OnModuleInit {
  private readonly logger = new Logger(OwnerSummaryDeliveryProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly queues: WorkerQueues,
  ) {}

  onModuleInit(): void {
    this.runtime.start('owner-summary-delivery', (payload) => this.run(payload))
  }

  async run({ companyId, summaryId }: JobPayloads['owner-summary-delivery']): Promise<OwnerSummaryDeliveryResult> {
    const db = this.clients.get()
    const [summary] = unwrap(
      await db.rpc('reports_owner_summary_message', { p_company_id: companyId, p_summary_id: summaryId }),
      'Load the stored owner summary',
      [],
    )
    if (!summary) throw new UnrecoverableError('The stored owner summary was not found')

    const mappingResult = await db
      .from('message_type_templates')
      .select('message_template_id')
      .eq('company_id', companyId)
      .eq('message_type', 'owner_weekly_summary')
      .maybeSingle()
    const mapping = unwrap(mappingResult, 'Load the owner summary template mapping', null)
    const templateResult = mapping
      ? await db.from('message_templates').select('body').eq('company_id', companyId).eq('id', mapping.message_template_id).maybeSingle()
      : null
    const template = templateResult ? unwrap(templateResult, 'Load the owner summary template', null) : null
    if (!template) return this.blocked(companyId, summaryId, 'No WhatsApp template is chosen for the weekly owner summary')

    let body: string
    try {
      body = ownerSummaryMessage(template.body, summary.template_values)
    } catch (error) {
      if (error instanceof MissingTemplateVariablesError) {
        return this.blocked(companyId, summaryId, 'The weekly owner summary template needs values LeaseGuard does not have')
      }
      throw error
    }

    const [recorded] = unwrap(
      await db.rpc('record_owner_weekly_summary_message', {
        p_company_id: companyId,
        p_owner_user_id: summary.owner_user_id,
        p_week_start: summary.week_start,
        p_body: body,
      }),
      'Record the owner summary message',
      [],
    )
    if (!recorded) throw new Error('Recording the owner summary message returned nothing')
    if (recorded.outcome === 'blocked' || !recorded.communication_id) {
      return this.blocked(companyId, summaryId, recorded.reason ?? 'The owner summary could not be recorded')
    }

    await this.queues.enqueueAll('message-delivery', [{ companyId, communicationId: recorded.communication_id }])
    return { outcome: 'queued', communicationId: recorded.communication_id, recorded: recorded.outcome === 'existing' ? 'existing' : 'created' }
  }

  private blocked(companyId: EntityId, summaryId: EntityId, reason: string): OwnerSummaryDeliveryResult {
    this.logger.warn({ companyId, summaryId, reason }, 'Weekly owner summary not sent')
    return { outcome: 'blocked', reason }
  }
}
