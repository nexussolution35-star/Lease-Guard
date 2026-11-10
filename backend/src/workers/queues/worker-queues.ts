import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { type JobSchedulerTemplateOptions, Queue, type RepeatOptions } from 'bullmq'
import type { Redis } from 'ioredis'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import { DEFAULT_JOB_OPTIONS, jobIdFor, type JobPayloads, QUEUE_NAMES, type QueueName } from '../../infrastructure/queues/queue-registry'
import { createQueueConnection } from '../../infrastructure/queues/redis-connection'

/**
 * Owns the worker process's Redis connection and one BullMQ Queue per registered queue name. Processors
 * (via ProcessorRuntime) share the connection; the dispatch enqueues follow-up jobs and the scheduler
 * registers repeatable jobs through this class.
 */
@Injectable()
export class WorkerQueues implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerQueues.name)
  /** Shared queue connection; BullMQ workers duplicate it for their blocking connection. */
  readonly connection: Redis
  private readonly queues: ReadonlyMap<QueueName, Queue>
  private redisErrorLogged = false

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {
    this.connection = createQueueConnection(env.REDIS_URL)
    // Connection errors surface on the connection and on every queue; log each outage once.
    const onError = (error: Error): void => {
      if (this.redisErrorLogged) return
      this.redisErrorLogged = true
      this.logger.warn(`Redis unavailable, retrying: ${error.message}`)
    }
    this.connection.on('error', onError)
    this.connection.on('ready', () => {
      this.redisErrorLogged = false
    })
    this.queues = new Map(
      QUEUE_NAMES.map((name) => {
        const queue = new Queue(name, { connection: this.connection, prefix: env.QUEUE_PREFIX, defaultJobOptions: DEFAULT_JOB_OPTIONS })
        queue.on('error', onError)
        return [name, queue]
      }),
    )
  }

  /** Does not block startup: while Redis is down the process stays up, logs, and still stops on SIGTERM. */
  onModuleInit(): void {
    this.logger.log(`Managing queues (prefix "${this.env.QUEUE_PREFIX}"): ${QUEUE_NAMES.join(', ')}`)
    Promise.all([...this.queues.values()].map((queue) => queue.waitUntilReady())).then(
      () => this.logger.log('Connected to Redis'),
      (error: unknown) => this.logger.error(`Queues could not connect to Redis: ${String(error)}`),
    )
  }

  /**
   * Enqueues jobs with deterministic ids (`jobIdFor`): a job id that already exists is not added again,
   * so re-running a fan-out is safe. Resolves with the job ids.
   */
  async enqueueAll<Q extends QueueName>(queue: Q, payloads: readonly JobPayloads[Q][]): Promise<string[]> {
    if (payloads.length === 0) return []
    const jobs = payloads.map((payload) => ({ name: queue, data: payload, opts: { jobId: jobIdFor(queue, payload) } }))
    await this.queue(queue).addBulk(jobs)
    return jobs.map((job) => job.opts.jobId)
  }

  /** Creates or updates a repeatable job (BullMQ job scheduler); idempotent across worker replicas. */
  async upsertJobScheduler<Q extends QueueName>(
    queue: Q,
    schedulerId: string,
    repeat: Pick<RepeatOptions, 'pattern' | 'tz'>,
    template: { name: string; data: JobPayloads[Q]; opts?: JobSchedulerTemplateOptions },
  ): Promise<void> {
    await this.queue(queue).upsertJobScheduler(schedulerId, repeat, template)
  }

  private queue(name: QueueName): Queue {
    const queue = this.queues.get(name)
    if (!queue) throw new Error(`Queue ${name} is not registered`)
    return queue
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()))
    await this.connection.quit()
    this.logger.log('Queues closed')
  }
}
