import { randomUUID } from 'node:crypto'
import { Queue, type Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DEFAULT_JOB_OPTIONS, jobIdFor, type JobPayloads, processedMarkerKey, type QueueName } from '../../infrastructure/queues/queue-registry'
import { UndeliverableMessageError } from '../messaging/message-delivery.processor'
import { createIdempotentWorker, type JobLogger, type JobRunEvent } from './idempotent-worker'

/**
 * Runs against a real Redis. Locally:
 *   docker run -d --rm --name lg-backend-redis-test -p 127.0.0.1:56380:6379 redis:7.4-alpine
 *   REDIS_TEST_URL=redis://127.0.0.1:56380 pnpm --filter @leaseguard/backend test
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL
if (!REDIS_TEST_URL) {
  process.stderr.write('Skipping BullMQ integration tests: set REDIS_TEST_URL (e.g. redis://127.0.0.1:56380) to run them.\n')
}

interface LogEntry {
  level: 'info' | 'warn' | 'error'
  fields: Record<string, unknown>
  message: string
}

function captureLogger(entries: LogEntry[]): JobLogger {
  const at = (level: LogEntry['level']) => (fields: object, message: string) =>
    entries.push({ level, fields: fields as Record<string, unknown>, message })
  return { info: at('info'), warn: at('warn'), error: at('error') }
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.skipIf(!REDIS_TEST_URL)('createIdempotentWorker against a real Redis (requires REDIS_TEST_URL)', () => {
  const runPrefix = `lgtest-${randomUUID().slice(0, 8)}`
  let connection: Redis
  let testIndex = 0
  const opened: (Worker | Queue)[] = []

  /** A queue plus a test-only processor under a prefix unique to this test. */
  async function setup<Q extends QueueName>(
    queueName: Q,
    process: (payload: JobPayloads[Q]) => Promise<void>,
  ): Promise<{ queue: Queue; prefix: string; logs: LogEntry[]; runs: JobRunEvent[] }> {
    const prefix = `${runPrefix}-${testIndex++}`
    const logs: LogEntry[] = []
    const runs: JobRunEvent[] = []
    const queue = new Queue(queueName, { connection, prefix, defaultJobOptions: DEFAULT_JOB_OPTIONS })
    const worker = createIdempotentWorker({
      queue: queueName,
      connection,
      prefix,
      logger: captureLogger(logs),
      process,
      recordRun: async (event) => {
        runs.push(event)
      },
    })
    opened.push(worker, queue)
    await worker.waitUntilReady()
    return { queue, prefix, logs, runs }
  }

  beforeAll(() => {
    connection = new Redis(REDIS_TEST_URL as string, { maxRetriesPerRequest: null })
  })

  afterEach(async () => {
    for (const closable of opened.splice(0).reverse()) await closable.close()
  })

  afterAll(async () => {
    const keys = await connection.keys(`${runPrefix}*`)
    if (keys.length > 0) await connection.del(...keys)
    await connection.quit()
  })

  it('processes an enqueued job once, even when it is enqueued twice', async () => {
    const processed: JobPayloads['statement-processing'][] = []
    const { queue, prefix, runs } = await setup('statement-processing', async (payload) => {
      processed.push(payload)
    })
    const payload = { companyId: 'cmp_a', statementId: 'stm_1' }
    const jobId = jobIdFor('statement-processing', payload)
    await queue.add('process', payload, { jobId })
    await queue.add('process', payload, { jobId })

    await waitFor(() => runs.length === 1)
    expect(processed).toEqual([payload])
    expect(runs[0]).toMatchObject({ queue: 'statement-processing', jobId, companyId: 'cmp_a', attempt: 1, outcome: 'completed' })
    expect(await connection.exists(processedMarkerKey(prefix, 'statement-processing', jobId))).toBe(1)
  })

  it('retries a failed attempt with exponential backoff, then completes', async () => {
    const attemptsAt: number[] = []
    const { queue, logs, runs } = await setup('arrears-monitoring', async () => {
      attemptsAt.push(Date.now())
      if (attemptsAt.length === 1) throw new Error('transient: provider timeout')
    })
    const payload = { companyId: 'cmp_a', asOf: '2026-11-07' }
    await queue.add('scan', payload, {
      jobId: jobIdFor('arrears-monitoring', payload),
      attempts: 3,
      backoff: { type: 'exponential', delay: 300 },
    })

    await waitFor(() => runs.some((run) => run.outcome === 'completed'))
    expect(attemptsAt).toHaveLength(2)
    expect(attemptsAt[1] - attemptsAt[0]).toBeGreaterThanOrEqual(300)
    expect(runs.map((run) => [run.outcome, run.attempt, run.willRetry])).toEqual([
      ['failed', 1, true],
      ['completed', 2, false],
    ])
    expect(logs).toContainEqual({
      level: 'error',
      message: 'Job attempt failed; retrying with backoff',
      fields: expect.objectContaining({ queue: 'arrears-monitoring', companyId: 'cmp_a', attempt: 1, maxAttempts: 3, willRetry: true }),
    })
  })

  it('skips a re-delivered job id that already completed', async () => {
    let calls = 0
    const { queue, logs, runs } = await setup('message-delivery', async () => {
      calls++
    })
    const payload = { companyId: 'cmp_a', communicationId: 'com_1' }
    const jobId = jobIdFor('message-delivery', payload)
    // removeOnComplete lets BullMQ accept the same id again, as after its retention window.
    await queue.add('deliver', payload, { jobId, removeOnComplete: true })
    await waitFor(() => runs.length === 1)
    await queue.add('deliver', payload, { jobId, removeOnComplete: true })
    await waitFor(() => runs.length === 2)

    expect(calls).toBe(1)
    expect(runs.map((run) => run.outcome)).toEqual(['completed', 'skipped_duplicate'])
    expect(logs).toContainEqual(expect.objectContaining({ level: 'info', message: 'Job already processed; skipping duplicate' }))
  })

  it('logs permanent failures, and never retries a message the delivery gate blocks', async () => {
    const { queue, logs, runs } = await setup('message-delivery', async () => {
      // What the delivery processor throws when the outbound gate blocks a message.
      throw new UndeliverableMessageError(['Property manager approval is required before sending'])
    })
    const payload = { companyId: 'cmp_a', communicationId: 'com_pending' }
    const jobId = jobIdFor('message-delivery', payload)
    await queue.add('deliver', payload, { jobId })

    await waitFor(() => runs.length === 1)
    expect(runs[0]).toMatchObject({ outcome: 'failed', attempt: 1, maxAttempts: 5, willRetry: false })
    expect(runs[0].error).toMatch(/approval is required/)
    expect(logs).toContainEqual({
      level: 'error',
      message: 'Job failed permanently',
      fields: expect.objectContaining({ queue: 'message-delivery', jobId, companyId: 'cmp_a', attempt: 1, willRetry: false }),
    })
    expect(await queue.getJobState(jobId)).toBe('failed')
  })
})
