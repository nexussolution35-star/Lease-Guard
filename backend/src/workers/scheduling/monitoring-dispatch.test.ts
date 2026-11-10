import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { jobIdFor, type JobPayloads, type QueueName } from '../../infrastructure/queues/queue-registry'
import type { WorkerQueues } from '../queues/worker-queues'
import { clientsFor, COMPANY, fixedClock, OTHER_COMPANY, unusedRuntime } from '../workers.test-helpers'
import { MonitoringDispatchProcessor } from './monitoring-dispatch.processor'
import { MonitoringScheduler } from './monitoring-scheduler'

function harness(companies: { id: string }[]) {
  const db = fakeDb(() => ({ data: companies, error: null }))
  const enqueued: [QueueName, unknown[]][] = []
  const queues = {
    enqueueAll: vi.fn(async <Q extends QueueName>(queue: Q, payloads: readonly JobPayloads[Q][]) => {
      enqueued.push([queue, [...payloads]])
      return payloads.map((payload) => jobIdFor(queue, payload))
    }),
  } as unknown as WorkerQueues
  const processor = new MonitoringDispatchProcessor(unusedRuntime, clientsFor(db.client), queues, fixedClock('2026-11-09T04:00:00Z'))
  return { processor, queries: db.queries, enqueued }
}

describe('MonitoringDispatchProcessor', () => {
  it('enqueues the three daily scans for every active company with deterministic ids', async () => {
    const { processor, queries, enqueued } = harness([{ id: COMPANY }, { id: OTHER_COMPANY }])
    const summary = await processor.dispatch({})

    expect(queries).toHaveLength(1)
    expect(queries[0].table).toBe('companies')
    expect(callsTo(queries[0], 'eq')).toEqual([['status', 'active']])
    expect(enqueued.map(([queue]) => queue)).toEqual(['lease-monitoring', 'arrears-monitoring', 'arrangement-reminders'])
    for (const [, payloads] of enqueued) {
      expect(payloads).toEqual([
        { companyId: COMPANY, asOf: '2026-11-09' },
        { companyId: OTHER_COMPANY, asOf: '2026-11-09' },
      ])
    }
    expect(summary.jobIds['lease-monitoring']).toEqual([`lease-monitoring.${COMPANY}.2026-11-09`, `lease-monitoring.${OTHER_COMPANY}.2026-11-09`])
  })

  it('uses the date of a manual trigger and rejects a malformed one', async () => {
    const { processor, enqueued } = harness([{ id: COMPANY }])
    await expect(processor.dispatch({ asOf: '2026-12-01' })).resolves.toMatchObject({ asOf: '2026-12-01', companies: 1 })
    expect(enqueued[0][1]).toEqual([{ companyId: COMPANY, asOf: '2026-12-01' }])
    await expect(processor.dispatch({ asOf: '01/12/2026' })).rejects.toThrow(/Invalid asOf/)
  })

  it('enqueues nothing when there are no active companies', async () => {
    const { processor } = harness([])
    await expect(processor.dispatch({})).resolves.toMatchObject({ companies: 0 })
  })
})

describe('MonitoringScheduler', () => {
  it('registers the dispatch at 06:00 Africa/Johannesburg without an asOf', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined)
    await new MonitoringScheduler({ upsertJobScheduler } as unknown as WorkerQueues).register()
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'monitoring-dispatch',
      'daily-monitoring-dispatch',
      { pattern: '0 6 * * *', tz: 'Africa/Johannesburg' },
      expect.objectContaining({ name: 'dispatch', data: {} }),
    )
  })

  it('logs instead of crashing when Redis rejects the registration', async () => {
    const upsertJobScheduler = vi.fn(async () => {
      throw new Error('Connection is closed.')
    })
    await expect(new MonitoringScheduler({ upsertJobScheduler } as unknown as WorkerQueues).register()).resolves.toBeUndefined()
  })
})
