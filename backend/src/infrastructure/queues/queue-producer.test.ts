import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { testApiEnv } from '../storage/storage.test-helpers'
import { QueueProducer } from './queue-producer'
import { jobIdFor, processedMarkerKey } from './queue-registry'

/** A stored BullMQ job as the fake queue sees it. */
interface FakeJob {
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed'
  failedReason: string
  getState: () => Promise<string>
  retry: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const fake = vi.hoisted(() => ({
  jobs: new Map<string, unknown>(),
  add: vi.fn(),
  del: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: class {
    on(): void {}
    async getJob(id: string): Promise<unknown> {
      return fake.jobs.get(id)
    }
    async add(name: string, data: unknown, opts: { jobId: string }): Promise<void> {
      fake.add(name, data, opts)
      // BullMQ ignores an add whose job id already exists.
      if (!fake.jobs.has(opts.jobId)) fake.jobs.set(opts.jobId, job('waiting'))
    }
    async close(): Promise<void> {}
  },
}))

vi.mock('./redis-connection', () => ({
  createProducerConnection: () => ({ del: fake.del, quit: async () => 'OK' }),
}))

function job(state: FakeJob['state'], failedReason = ''): FakeJob {
  const stored: FakeJob = {
    state,
    failedReason,
    getState: async () => stored.state,
    retry: vi.fn(async () => {
      stored.state = 'waiting'
    }),
    remove: vi.fn(async () => {
      for (const [id, value] of fake.jobs) if (value === stored) fake.jobs.delete(id)
    }),
  }
  return stored
}

const PAYLOAD = { companyId: '0b6c7c38-3f43-4e0e-8f1e-2d5b1f6f9a01', statementId: '6f1d2c1e-0000-4000-8000-0000000000aa' }
const JOB_ID = jobIdFor('statement-processing', PAYLOAD)
const MARKER = processedMarkerKey('leaseguard-test', 'statement-processing', JOB_ID)

describe('QueueProducer.enqueueOrRetry', () => {
  let producer: QueueProducer

  beforeEach(() => {
    fake.jobs.clear()
    fake.add.mockClear()
    fake.del.mockClear()
    producer = new QueueProducer(testApiEnv())
  })

  it('adds the job when none has the id', async () => {
    await expect(producer.enqueueOrRetry('statement-processing', PAYLOAD)).resolves.toEqual({ jobId: JOB_ID, outcome: 'added' })
    expect(fake.add).toHaveBeenCalledWith('statement-processing', PAYLOAD, { jobId: JOB_ID })
  })

  it.each(['waiting', 'active', 'delayed'] as const)('leaves a %s job alone', async (state) => {
    const existing = job(state)
    fake.jobs.set(JOB_ID, existing)
    await expect(producer.enqueueOrRetry('statement-processing', PAYLOAD)).resolves.toEqual({ jobId: JOB_ID, outcome: 'already_queued' })
    expect(fake.add).not.toHaveBeenCalled()
    expect(existing.retry).not.toHaveBeenCalled()
    expect(existing.remove).not.toHaveBeenCalled()
  })

  it('retries a permanently failed job with fresh attempts', async () => {
    const failed = job('failed', 'document-processing unavailable')
    fake.jobs.set(JOB_ID, failed)
    await expect(producer.enqueueOrRetry('statement-processing', PAYLOAD)).resolves.toEqual({
      jobId: JOB_ID,
      outcome: 'retried',
      failedReason: 'document-processing unavailable',
    })
    expect(failed.retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true })
    expect(failed.state).toBe('waiting')
  })

  it('leaves a failed job when the policy refuses to retry it', async () => {
    const failed = job('failed', 'Message sent as wamid.1 but its status could not be saved')
    fake.jobs.set(JOB_ID, failed)
    const result = await producer.enqueueOrRetry('statement-processing', PAYLOAD, { retryFailed: (reason) => !reason.startsWith('Message sent') })
    expect(result).toMatchObject({ outcome: 'not_retried', failedReason: 'Message sent as wamid.1 but its status could not be saved' })
    expect(failed.retry).not.toHaveBeenCalled()
  })

  it('treats a concurrent retry as already queued', async () => {
    const failed = job('failed', 'boom')
    failed.retry.mockImplementationOnce(async () => {
      failed.state = 'waiting'
      throw new Error('Job is not in the failed state')
    })
    fake.jobs.set(JOB_ID, failed)
    await expect(producer.enqueueOrRetry('statement-processing', PAYLOAD)).resolves.toMatchObject({ outcome: 'already_queued' })
  })

  it('removes a completed job and its processed marker, then adds it again', async () => {
    const completed = job('completed')
    fake.jobs.set(JOB_ID, completed)
    const order: string[] = []
    completed.remove.mockImplementationOnce(async () => {
      order.push('remove')
      fake.jobs.delete(JOB_ID)
    })
    fake.del.mockImplementationOnce(async () => order.push('del'))
    fake.add.mockImplementationOnce(() => order.push('add'))

    await expect(producer.enqueueOrRetry('statement-processing', PAYLOAD)).resolves.toEqual({ jobId: JOB_ID, outcome: 'requeued' })

    expect(fake.del).toHaveBeenCalledWith(MARKER)
    expect(order).toEqual(['remove', 'del', 'add'])
    expect((fake.jobs.get(JOB_ID) as FakeJob).state).toBe('waiting')
  })

  it('answers 503 when Redis fails', async () => {
    fake.jobs.set(JOB_ID, { getState: async () => Promise.reject(new Error('ECONNREFUSED')) })
    await expect(producer.enqueueOrRetry('statement-processing', PAYLOAD)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('QueueProducer.isRunning', () => {
  let producer: QueueProducer

  beforeEach(() => {
    fake.jobs.clear()
    producer = new QueueProducer(testApiEnv())
  })

  it('is true only while a worker processes the job', async () => {
    await expect(producer.isRunning('statement-processing', PAYLOAD)).resolves.toBe(false)
    for (const state of ['waiting', 'delayed', 'completed', 'failed'] as const) {
      fake.jobs.set(JOB_ID, job(state))
      await expect(producer.isRunning('statement-processing', PAYLOAD)).resolves.toBe(false)
    }
    fake.jobs.set(JOB_ID, job('active'))
    await expect(producer.isRunning('statement-processing', PAYLOAD)).resolves.toBe(true)
  })

  it('answers 503 when Redis fails', async () => {
    fake.jobs.set(JOB_ID, { getState: async () => Promise.reject(new Error('ECONNREFUSED')) })
    await expect(producer.isRunning('statement-processing', PAYLOAD)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
