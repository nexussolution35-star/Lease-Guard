import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import {
  WORKER_CAPABILITIES_REFRESH_MS,
  WORKER_CAPABILITIES_TTL_SECONDS,
  workerCapabilitiesKey,
  workerCapabilityReport,
} from '../../infrastructure/capabilities/worker-capabilities'
import { Clock } from '../shared/clock'
import { WorkerQueues } from '../queues/worker-queues'

/**
 * Publishes what this worker can do (infrastructure/capabilities/worker-capabilities.ts) so the API can
 * tell company admins, without the API ever holding worker-only settings. Refreshed periodically; the
 * report expires when no worker refreshes it. Never blocks startup: while Redis is down it logs once.
 */
@Injectable()
export class WorkerCapabilitiesReporter implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerCapabilitiesReporter.name)
  private timer: NodeJS.Timeout | undefined
  private failureLogged = false

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly queues: WorkerQueues,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    void this.publish()
    this.timer = setInterval(() => void this.publish(), WORKER_CAPABILITIES_REFRESH_MS)
    this.timer.unref()
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer)
  }

  async publish(): Promise<void> {
    const report = workerCapabilityReport(this.env, this.clock.now())
    try {
      await this.queues.connection.set(workerCapabilitiesKey(this.env.QUEUE_PREFIX), JSON.stringify(report), 'EX', WORKER_CAPABILITIES_TTL_SECONDS)
      this.failureLogged = false
    } catch (error) {
      if (this.failureLogged) return
      this.failureLogged = true
      this.logger.warn(`Could not report worker capabilities: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
