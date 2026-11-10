import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'

import { DEFAULT_JOB_OPTIONS, MONITORING_DISPATCH_SCHEDULE } from '../../infrastructure/queues/queue-registry'
import { WorkerQueues } from '../queues/worker-queues'

/**
 * Registers the daily monitoring dispatch (06:00 Africa/Johannesburg) as a BullMQ job scheduler. Upsert
 * is idempotent, so every worker replica may register it on start; Redis holds one schedule. Startup is
 * never blocked: while Redis is down the registration waits for the connection and logs on failure.
 */
@Injectable()
export class MonitoringScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MonitoringScheduler.name)

  constructor(private readonly queues: WorkerQueues) {}

  onApplicationBootstrap(): void {
    void this.register()
  }

  async register(): Promise<void> {
    const { schedulerId, pattern, tz } = MONITORING_DISPATCH_SCHEDULE
    try {
      await this.queues.upsertJobScheduler('monitoring-dispatch', schedulerId, { pattern, tz }, {
        name: 'dispatch',
        // No asOf: the processor uses today's South African date when the job runs.
        data: {},
        opts: { ...DEFAULT_JOB_OPTIONS },
      })
      this.logger.log(`Scheduled ${schedulerId} at "${pattern}" (${tz})`)
    } catch (error) {
      this.logger.error(`Could not register ${schedulerId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
