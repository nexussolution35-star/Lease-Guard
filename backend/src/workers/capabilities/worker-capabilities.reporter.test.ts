import { describe, expect, it, vi } from 'vitest'

import type { WorkerEnv } from '../../config/env'
import type { Clock } from '../shared/clock'
import type { WorkerQueues } from '../queues/worker-queues'
import { WorkerCapabilitiesReporter } from './worker-capabilities.reporter'

function reporter(env: Partial<WorkerEnv>, set = vi.fn(async () => 'OK')) {
  const queues = { connection: { set } } as unknown as WorkerQueues
  const clock = { now: () => new Date('2026-11-10T08:00:00.000Z') } as Clock
  return { reporter: new WorkerCapabilitiesReporter({ QUEUE_PREFIX: 'lg-test', ...env } as WorkerEnv, queues, clock), set }
}

describe('WorkerCapabilitiesReporter', () => {
  it('publishes booleans under the queue prefix with an expiry, never the Anthropic key', async () => {
    const { reporter: worker, set } = reporter({ ANTHROPIC_API_KEY: 'sk-ant-secret' })
    await worker.publish()
    expect(set).toHaveBeenCalledWith(
      'lg-test:worker-capabilities',
      JSON.stringify({ agentRuntimeConfigured: true, numberVerificationConfigured: false, reportedAt: '2026-11-10T08:00:00.000Z' }),
      'EX',
      300,
    )
    expect(JSON.stringify(set.mock.calls)).not.toContain('sk-ant-secret')
  })

  it('keeps the worker running when Redis is unavailable', async () => {
    const { reporter: worker } = reporter({}, vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
    await expect(worker.publish()).resolves.toBeUndefined()
  })
})
