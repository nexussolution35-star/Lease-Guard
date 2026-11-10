import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { Redis } from 'ioredis'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { parseWorkerCapabilityReport, type WorkerCapabilityReport, workerCapabilitiesKey } from './worker-capabilities'

const READ_TIMEOUT_MS = 2_000

/**
 * The API's view of the worker's capability report (worker-capabilities.ts). Read on demand; when Redis
 * is unreachable or no worker has reported, the answer is null ("not reported"), never an error, so the
 * WhatsApp integration page still loads.
 */
@Injectable()
export class WorkerCapabilitiesReader implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerCapabilitiesReader.name)
  private readonly redis: Redis
  private failureLogged = false

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.redis = new Redis(env.REDIS_URL, {
      // Connect on bootstrap, not on construction, so building the OpenAPI document needs no Redis.
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: READ_TIMEOUT_MS,
      retryStrategy: (attempt) => Math.min(attempt * 1000, 10_000),
    })
    // Readiness reports Redis outages; this reader only needs to stay quiet and answer null.
    this.redis.on('error', () => undefined)
  }

  onApplicationBootstrap(): void {
    this.redis.connect().catch(() => undefined)
  }

  onApplicationShutdown(): void {
    this.redis.disconnect()
  }

  async read(): Promise<WorkerCapabilityReport | null> {
    let timer: NodeJS.Timeout | undefined
    try {
      const raw = await Promise.race([
        this.redis.get(workerCapabilitiesKey(this.env.QUEUE_PREFIX)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), READ_TIMEOUT_MS)
        }),
      ])
      this.failureLogged = false
      return parseWorkerCapabilityReport(raw)
    } catch (error) {
      if (!this.failureLogged) {
        this.failureLogged = true
        this.logger.warn(`Could not read the worker capability report: ${error instanceof Error ? error.message : String(error)}`)
      }
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
