import type { EntityId, ISODateTime } from '@leaseguard/domain'
import { type Job, UnrecoverableError, Worker } from 'bullmq'
import type { Redis } from 'ioredis'

import { companyIdOf, type JobPayloads, processedMarkerKey, type QueueName } from '../../infrastructure/queues/queue-registry'

/** Structured logger (pino's call shape: merge object first, message second). */
export interface JobLogger {
  info(fields: object, message: string): void
  warn(fields: object, message: string): void
  error(fields: object, message: string): void
}

export interface JobRunEvent {
  queue: QueueName
  jobId: string
  /** BullMQ job name. */
  jobName: string
  /** Absent only for system-level jobs that span companies (the monitoring dispatch). */
  companyId?: EntityId
  /** The job's payload (identifiers only). */
  payload: JobPayloads[QueueName]
  /** 1-based attempt number. */
  attempt: number
  maxAttempts: number
  outcome: 'completed' | 'skipped_duplicate' | 'failed'
  willRetry: boolean
  error?: string
  /** When BullMQ started processing the attempt, when known. */
  startedAt?: ISODateTime
  /** Processing time of the attempt, when known. */
  durationMs?: number
  at: ISODateTime
}

/**
 * Hook for persisting job runs (see JobRunRecorderService, which writes `job_runs`). It receives every
 * completed, skipped and failed attempt; a failing recorder is logged and never fails the job.
 */
export type JobRunRecorder = (event: JobRunEvent) => Promise<void>

export interface IdempotentWorkerOptions<Q extends QueueName> {
  queue: Q
  /** Shared queue connection; BullMQ duplicates it for the blocking connection. */
  connection: Redis
  prefix: string
  logger: JobLogger
  process: (payload: JobPayloads[Q], job: Job<JobPayloads[Q]>) => Promise<void>
  recordRun?: JobRunRecorder
  concurrency?: number
  /** How long a completed job id is remembered. Default 30 days. */
  processedTtlSeconds?: number
}

const DEFAULT_PROCESSED_TTL_SECONDS = 30 * 24 * 3600

/**
 * Creates the BullMQ Worker every LeaseGuard processor must use. It adds:
 *
 * - idempotency: a job id that already completed (deterministic ids from `jobIdFor`) is skipped, even
 *   when re-enqueued after BullMQ removed the finished job. The marker is written after success, so
 *   delivery is at-least-once and `process` must stay safe to repeat if the process dies in between;
 * - structured failure logging (queue, job id, company, attempt, whether it will retry) and stall
 *   warnings;
 * - the optional `recordRun` hook.
 */
export function createIdempotentWorker<Q extends QueueName>(options: IdempotentWorkerOptions<Q>): Worker<JobPayloads[Q]> {
  const { queue, connection, prefix, logger } = options
  const ttl = options.processedTtlSeconds ?? DEFAULT_PROCESSED_TTL_SECONDS

  const record = async (
    job: Job<JobPayloads[Q]>,
    outcome: JobRunEvent['outcome'],
    attempt: number,
    failure?: { error: Error; willRetry: boolean },
  ): Promise<void> => {
    if (!options.recordRun) return
    const now = Date.now()
    const companyId = companyIdOf(job.data)
    try {
      await options.recordRun({
        queue,
        jobId: String(job.id),
        jobName: job.name,
        ...(companyId === undefined ? {} : { companyId }),
        payload: job.data,
        attempt,
        maxAttempts: job.opts.attempts ?? 1,
        outcome,
        willRetry: failure?.willRetry ?? false,
        ...(failure ? { error: failure.error.message } : {}),
        ...(job.processedOn ? { startedAt: new Date(job.processedOn).toISOString(), durationMs: Math.max(0, now - job.processedOn) } : {}),
        at: new Date(now).toISOString(),
      })
    } catch (recordError) {
      logger.error({ queue, jobId: job.id, err: String(recordError) }, 'Recording the job run failed')
    }
  }

  const worker = new Worker<JobPayloads[Q]>(
    queue,
    async (job) => {
      const jobId = String(job.id)
      const markerKey = processedMarkerKey(prefix, queue, jobId)
      if (await connection.exists(markerKey)) {
        logger.info({ queue, jobId, companyId: companyIdOf(job.data) }, 'Job already processed; skipping duplicate')
        await record(job, 'skipped_duplicate', job.attemptsMade + 1)
        return
      }
      await options.process(job.data, job)
      await connection.set(markerKey, new Date().toISOString(), 'EX', ttl)
      await record(job, 'completed', job.attemptsMade + 1)
    },
    { connection, prefix, concurrency: options.concurrency ?? 1 },
  )

  worker.on('failed', (job, error) => {
    if (!job) return
    const maxAttempts = job.opts.attempts ?? 1
    // BullMQ has already counted the failed attempt in attemptsMade.
    const willRetry = job.attemptsMade < maxAttempts && !(error instanceof UnrecoverableError)
    logger.error(
      {
        queue,
        jobId: job.id,
        companyId: companyIdOf(job.data),
        attempt: job.attemptsMade,
        maxAttempts,
        willRetry,
        err: error.message,
      },
      willRetry ? 'Job attempt failed; retrying with backoff' : 'Job failed permanently',
    )
    void record(job, 'failed', job.attemptsMade, { error, willRetry })
  })
  worker.on('stalled', (jobId, previousState) => {
    logger.warn({ queue, jobId, previousState }, 'Job stalled; BullMQ will retry it')
  })
  worker.on('error', (error) => {
    logger.error({ queue, err: error.message }, 'Worker error')
  })
  return worker
}
