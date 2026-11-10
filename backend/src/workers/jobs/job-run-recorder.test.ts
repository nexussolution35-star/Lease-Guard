import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { clientsFor, COMPANY, STATEMENT } from '../workers.test-helpers'
import type { JobRunEvent } from './idempotent-worker'
import { JobRunRecorderService, toJobRunInsert } from './job-run-recorder'

const base: JobRunEvent = {
  queue: 'statement-processing',
  jobId: `statement-processing.${COMPANY}.${STATEMENT}`,
  jobName: 'statement-processing',
  companyId: COMPANY,
  payload: { companyId: COMPANY, statementId: STATEMENT },
  attempt: 2,
  maxAttempts: 5,
  outcome: 'failed',
  willRetry: true,
  error: 'Document processing service unreachable',
  startedAt: '2026-11-09T04:00:00.000Z',
  durationMs: 1234.4,
  at: '2026-11-09T04:00:01.234Z',
}

describe('toJobRunInsert', () => {
  it('records a failed attempt that will be retried, linked to its statement', () => {
    expect(toJobRunInsert(base)).toEqual({
      company_id: COMPANY,
      queue: 'statement-processing',
      job_name: 'statement-processing',
      queue_job_id: base.jobId,
      status: 'failed',
      attempts: 2,
      max_attempts: 5,
      will_retry: true,
      entity_type: 'statement',
      entity_id: STATEMENT,
      started_at: '2026-11-09T04:00:00.000Z',
      finished_at: '2026-11-09T04:00:01.234Z',
      duration_ms: 1234,
      error_message: 'Document processing service unreachable',
    })
  })

  it('maps completed and skipped outcomes and never marks them for retry', () => {
    expect(toJobRunInsert({ ...base, outcome: 'completed', willRetry: true, error: undefined })).toMatchObject({ status: 'succeeded', will_retry: false })
    expect(toJobRunInsert({ ...base, outcome: 'skipped_duplicate', willRetry: false })).toMatchObject({ status: 'skipped' })
  })

  it('records the system-level dispatch without a company or entity', () => {
    const { companyId: _companyId, ...rest } = base
    const row = toJobRunInsert({ ...rest, queue: 'monitoring-dispatch', jobName: 'dispatch', payload: {}, outcome: 'completed', startedAt: undefined })
    expect(row).toMatchObject({ company_id: null, queue: 'monitoring-dispatch', started_at: base.at, finished_at: base.at })
    expect(row).not.toHaveProperty('entity_id')
  })

  it('does not link entities whose id is not a uuid', () => {
    expect(toJobRunInsert({ ...base, payload: { companyId: 'cmp_a', communicationId: 'com_1' } })).not.toHaveProperty('entity_id')
  })
})

describe('JobRunRecorderService', () => {
  it('inserts one job_runs row', async () => {
    const db = fakeDb(() => ({ data: null, error: null }))
    await new JobRunRecorderService(clientsFor(db.client)).record(base)
    expect(db.queries).toHaveLength(1)
    expect(db.queries[0].table).toBe('job_runs')
    expect(callsTo(db.queries[0], 'insert')[0][0]).toMatchObject({ queue_job_id: base.jobId })
  })

  it('throws on a database error so createIdempotentWorker logs it (the job itself is unaffected)', async () => {
    const db = fakeDb(() => ({ data: null, error: { code: '23514', message: 'check violation' } }))
    await expect(new JobRunRecorderService(clientsFor(db.client)).record(base)).rejects.toThrow('job_runs insert failed (23514)')
  })
})
