import { Injectable } from '@nestjs/common'
import type { EntityType } from '@leaseguard/domain'

import type { TablesInsert } from '../../infrastructure/database/database.types'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobRunEvent } from './idempotent-worker'

const OUTCOME_STATUS: Record<JobRunEvent['outcome'], 'succeeded' | 'skipped' | 'failed'> = {
  completed: 'succeeded',
  skipped_duplicate: 'skipped',
  failed: 'failed',
}

const MAX_ERROR_LENGTH = 2000
const RECORD_TIMEOUT_MS = 5_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The record a job acts on, linked from its job_runs row. */
function entityOf(payload: JobRunEvent['payload']): { type: EntityType; id: string } | undefined {
  if ('statementId' in payload) return { type: 'statement', id: payload.statementId }
  if ('communicationId' in payload) return { type: 'communication', id: payload.communicationId }
  return undefined
}

/** One job_runs row per finished attempt. Pure, so the mapping is unit tested without a database. */
export function toJobRunInsert(event: JobRunEvent): TablesInsert<'job_runs'> {
  const entity = entityOf(event.payload)
  return {
    company_id: event.companyId ?? null,
    queue: event.queue,
    job_name: event.jobName,
    queue_job_id: event.jobId,
    status: OUTCOME_STATUS[event.outcome],
    attempts: event.attempt,
    max_attempts: Math.max(1, event.maxAttempts),
    will_retry: event.outcome === 'failed' && event.willRetry,
    // entity_id is a uuid column; ids from elsewhere (tests, malformed payloads) are not linked.
    ...(entity && UUID.test(entity.id) ? { entity_type: entity.type, entity_id: entity.id } : {}),
    started_at: event.startedAt ?? event.at,
    finished_at: event.at,
    ...(event.durationMs === undefined ? {} : { duration_ms: Math.round(event.durationMs) }),
    ...(event.error === undefined ? {} : { error_message: event.error.slice(0, MAX_ERROR_LENGTH) }),
  }
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer))
}

/**
 * Persists every job attempt to `job_runs` through the service-role client (the table is closed to
 * end users). Throws on failure; createIdempotentWorker catches, logs and continues, so recording can
 * never fail or retry a job. A timeout keeps a slow database from holding a job open.
 */
@Injectable()
export class JobRunRecorderService {
  constructor(private readonly clients: ServiceRoleClientFactory) {}

  async record(event: JobRunEvent): Promise<void> {
    const { error } = await withTimeout(this.clients.get().from('job_runs').insert(toJobRunInsert(event)), RECORD_TIMEOUT_MS)
    if (error) throw new Error(`job_runs insert failed (${error.code}): ${error.message}`)
  }
}
