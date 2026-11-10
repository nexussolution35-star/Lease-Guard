import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { type ISODate, isValidISODate } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import { DAILY_MONITORING_QUEUES, type DailyMonitoringQueue, type JobPayloads } from '../../infrastructure/queues/queue-registry'
import { ProcessorRuntime } from '../jobs/processor-runtime'
import { WorkerQueues } from '../queues/worker-queues'
import { Clock } from '../shared/clock'
import { fetchAll } from '../shared/db'

export interface DispatchSummary {
  asOf: ISODate
  companies: number
  jobIds: Record<DailyMonitoringQueue, string[]>
}

/**
 * Daily fan-out. Lists the active companies and enqueues one lease-monitoring, arrears-monitoring and
 * arrangement-reminders job per company for `asOf` (today in South Africa unless the payload names a
 * date). Job ids are deterministic (`<queue>.<companyId>.<asOf>`), so a retried or repeated dispatch for
 * the same day enqueues nothing new.
 *
 * The companies query is the one service-role query without a company_id filter: it reads only ids of
 * active companies, and every job it enqueues carries exactly one company.
 */
@Injectable()
export class MonitoringDispatchProcessor implements OnModuleInit {
  private readonly logger = new Logger(MonitoringDispatchProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly queues: WorkerQueues,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.runtime.start('monitoring-dispatch', (payload) => this.dispatch(payload))
  }

  async dispatch(payload: JobPayloads['monitoring-dispatch']): Promise<DispatchSummary> {
    const asOf = payload.asOf ?? this.clock.today()
    if (!isValidISODate(asOf)) throw new UnrecoverableError(`Invalid asOf date "${asOf}"`)
    const db = this.clients.get()
    const companies = await fetchAll('List active companies', (from, to) =>
      db.from('companies').select('id').eq('status', 'active').order('id').range(from, to),
    )
    const jobIds = {} as Record<DailyMonitoringQueue, string[]>
    for (const queue of DAILY_MONITORING_QUEUES) {
      jobIds[queue] = await this.queues.enqueueAll(
        queue,
        companies.map((company) => ({ companyId: company.id, asOf })),
      )
    }
    this.logger.log({ asOf, companies: companies.length }, 'Daily monitoring dispatched')
    return { asOf, companies: companies.length, jobIds }
  }
}
