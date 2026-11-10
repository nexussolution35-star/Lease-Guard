import { Inject, Injectable, Logger, type OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { jobIdFor, jobOptionsFor, type JobPayloads, processedMarkerKey, type QueueName } from './queue-registry'
import { createProducerConnection } from './redis-connection'

const ENQUEUE_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * What `enqueueOrRetry` did with the job id:
 * - `added`: no job had the id; a new job was added.
 * - `already_queued`: the job is waiting, delayed or running; it was left as it is.
 * - `retried`: the job had failed permanently; it was moved back to waiting with fresh attempts.
 * - `requeued`: the job had completed; it and its processed marker were removed and it was added again.
 * - `not_retried`: the job had failed permanently and the caller's policy refused to run it again.
 */
export const ENQUEUE_OUTCOMES = ['added', 'already_queued', 'retried', 'requeued', 'not_retried'] as const
export type EnqueueOutcome = (typeof ENQUEUE_OUTCOMES)[number]

export interface EnqueueResult {
  jobId: string
  outcome: EnqueueOutcome
  /** Why the job failed, for `retried` and `not_retried`. */
  failedReason?: string
}

export interface RetryPolicy {
  /** Whether a permanently failed job may run again, given its failure reason. Default: always. */
  retryFailed?: (failedReason: string) => boolean
}

/**
 * Enqueues background jobs from the API process. Job ids are deterministic (`jobIdFor`), so enqueueing
 * the same unit of work twice yields one job: retries of an HTTP request are safe.
 *
 * Queues are created lazily so the API starts (and reports itself not ready) while Redis is down.
 */
@Injectable()
export class QueueProducer implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueProducer.name)
  private connection: Redis | undefined
  private readonly queues = new Map<QueueName, Queue>()

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Adds one job; resolves with its id. Throws 503 when Redis cannot accept the job. */
  async enqueue<Q extends QueueName>(queue: Q, payload: JobPayloads[Q]): Promise<string> {
    const jobId = jobIdFor(queue, payload)
    try {
      await withTimeout(this.queue(queue).add(queue, payload, { jobId }), ENQUEUE_TIMEOUT_MS)
    } catch (error) {
      this.logger.error(`Could not enqueue ${jobId}: ${error instanceof Error ? error.message : String(error)}`)
      throw new ServiceUnavailableException('Background processing is not available; try again shortly')
    }
    return jobId
  }

  /**
   * Makes sure the unit of work will run, also when an earlier job for it is stuck in BullMQ's history.
   * `enqueue` alone cannot: the deterministic job id makes `Queue.add` a no-op while a failed or
   * completed job with that id is kept (`DEFAULT_JOB_OPTIONS`), so the work would never run again.
   *
   * Only call this when the record still needs the work (e.g. a statement still `uploaded`); the
   * outcome says what was done. Throws 503 when Redis cannot be reached.
   */
  async enqueueOrRetry<Q extends QueueName>(queue: Q, payload: JobPayloads[Q], policy: RetryPolicy = {}): Promise<EnqueueResult> {
    const jobId = jobIdFor(queue, payload)
    try {
      return await withTimeout(this.addOrRetry(queue, payload, jobId, policy), ENQUEUE_TIMEOUT_MS)
    } catch (error) {
      this.logger.error(`Could not enqueue or retry ${jobId}: ${error instanceof Error ? error.message : String(error)}`)
      throw new ServiceUnavailableException('Background processing is not available; try again shortly')
    }
  }

  /**
   * Whether a worker is processing the unit of work right now (BullMQ state `active`). A waiting or delayed job
   * has not started yet, so it is not running. Throws 503 when Redis cannot be reached.
   */
  async isRunning<Q extends QueueName>(queue: Q, payload: JobPayloads[Q]): Promise<boolean> {
    const jobId = jobIdFor(queue, payload)
    try {
      return await withTimeout(
        (async () => {
          const job = await this.queue(queue).getJob(jobId)
          return job ? (await job.getState()) === 'active' : false
        })(),
        ENQUEUE_TIMEOUT_MS,
      )
    } catch (error) {
      this.logger.error(`Could not read the state of ${jobId}: ${error instanceof Error ? error.message : String(error)}`)
      throw new ServiceUnavailableException('Background processing is not available; try again shortly')
    }
  }

  private async addOrRetry<Q extends QueueName>(
    name: Q,
    payload: JobPayloads[Q],
    jobId: string,
    policy: RetryPolicy,
  ): Promise<EnqueueResult> {
    const queue = this.queue(name)
    const job = await queue.getJob(jobId)
    const state = job ? await job.getState() : 'unknown'

    if (!job || state === 'unknown') {
      await queue.add(name, payload, { jobId })
      return { jobId, outcome: 'added' }
    }
    if (state === 'failed') {
      const failedReason = job.failedReason
      if (policy.retryFailed && !policy.retryFailed(failedReason)) return { jobId, outcome: 'not_retried', failedReason }
      try {
        // A permanently failed job has used its attempts; reset them so transient errors back off again.
        await job.retry('failed', { resetAttemptsMade: true })
      } catch (error) {
        // A concurrent request retried it first: it is no longer failed.
        if ((await job.getState()) === 'failed') throw error
        return { jobId, outcome: 'already_queued' }
      }
      this.logger.log(`Retried failed job ${jobId} (${failedReason})`)
      return { jobId, outcome: 'retried', failedReason }
    }
    if (state === 'completed') {
      try {
        await job.remove()
      } catch (error) {
        // A concurrent request removed (and possibly re-added) it first.
        if ((await job.getState()) === 'completed') throw error
      }
      // Without the marker the worker would skip the new job as a duplicate of the completed one. It is
      // removed after the old job and before the new one, so the new job cannot be skipped.
      await this.redis().del(processedMarkerKey(this.env.QUEUE_PREFIX, name, jobId))
      await queue.add(name, payload, { jobId })
      this.logger.log(`Re-queued completed job ${jobId}`)
      return { jobId, outcome: 'requeued' }
    }
    return { jobId, outcome: 'already_queued' }
  }

  /**
   * The API's Redis connection, for short-lived keys the worker reads next to a job (e.g. the single-use
   * registration PIN, infrastructure/whatsapp/registration-pins.ts). Same lazy connection as the queues.
   */
  redis(): Redis {
    this.connection ??= createProducerConnection(this.env.REDIS_URL)
    return this.connection
  }

  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name)
    if (!queue) {
      queue = new Queue(name, { connection: this.redis(), prefix: this.env.QUEUE_PREFIX, defaultJobOptions: jobOptionsFor(name) })
      queue.on('error', (error) => this.logger.warn(`Queue ${name}: ${error.message}`))
      this.queues.set(name, queue)
    }
    return queue
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()))
    if (this.connection) await this.connection.quit()
  }
}
