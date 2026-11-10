import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common'
import type { Worker } from 'bullmq'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import type { JobPayloads, QueueName } from '../../infrastructure/queues/queue-registry'
import { WorkerQueues } from '../queues/worker-queues'
import { createIdempotentWorker, type JobLogger } from './idempotent-worker'
import { JobRunRecorderService } from './job-run-recorder'

/** Which attempt of a job is running (1-based) and how many BullMQ allows. */
export interface JobAttempt {
  attempt: number
  maxAttempts: number
}

/** True when a failure now will not be retried, so the processor must leave its record in a final state. */
export function isFinalAttempt(attempt: JobAttempt): boolean {
  return attempt.attempt >= attempt.maxAttempts
}

export type JobHandler<Q extends QueueName> = (payload: JobPayloads[Q], attempt: JobAttempt) => Promise<unknown>

/** pino call shape (merge object first, message second) on top of the Nest logger (nestjs-pino). */
export function jobLogger(context: string): JobLogger {
  const logger = new Logger(context)
  return {
    info: (fields, message) => logger.log(fields, message),
    warn: (fields, message) => logger.warn(fields, message),
    error: (fields, message) => logger.error(fields, message),
  }
}

/**
 * Starts the BullMQ workers of the worker process: every processor registers its handler here in
 * onModuleInit. Each worker is built with createIdempotentWorker (idempotency markers, failure logging)
 * and records every attempt in job_runs. Workers are closed before the queues and the Redis connection
 * (beforeApplicationShutdown runs before WorkerQueues' onApplicationShutdown).
 */
@Injectable()
export class ProcessorRuntime implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ProcessorRuntime.name)
  private readonly workers: Worker[] = []

  constructor(
    private readonly queues: WorkerQueues,
    private readonly recorder: JobRunRecorderService,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  start<Q extends QueueName>(queue: Q, handler: JobHandler<Q>, options: { concurrency?: number } = {}): void {
    const worker = createIdempotentWorker({
      queue,
      connection: this.queues.connection,
      prefix: this.env.QUEUE_PREFIX,
      logger: jobLogger(`Queue:${queue}`),
      process: async (payload, job) => {
        await handler(payload, { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1 })
      },
      recordRun: (event) => this.recorder.record(event),
      ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    })
    this.workers.push(worker)
    this.logger.log(`Processing queue ${queue}`)
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()))
    this.logger.log('Workers closed')
  }
}
