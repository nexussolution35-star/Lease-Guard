import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { describe, expect, it } from 'vitest'

import { OwnerSummaryService } from '../reports/owner-summary.service'
import { OwnerSummaryWorker, ReportsWorkerModule } from './reports-worker.module'
import { loadReportsWorkerEnv } from './worker-env'

describe('reports worker', () => {
  it('builds its real module (every provider injectable) without starting its workers', async () => {
    const env = loadReportsWorkerEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      REDIS_URL: 'redis://127.0.0.1:9',
    })
    expect(env.QUEUE_PREFIX).toBe('leaseguard')
    // Providers are constructed; lifecycle hooks (workers, the scheduler) never run without init.
    const app = await NestFactory.create(ReportsWorkerModule.register(env), { logger: false, abortOnError: false })
    expect(app.get(OwnerSummaryWorker)).toBeInstanceOf(OwnerSummaryWorker)
    expect(app.get(OwnerSummaryService)).toBeInstanceOf(OwnerSummaryService)
    await app.get(OwnerSummaryWorker).onApplicationShutdown()
  })

  it('requires the service-role key (the reports HTTP service never reads it)', () => {
    expect(() => loadReportsWorkerEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', SUPABASE_URL: 'http://127.0.0.1:9', REDIS_URL: 'redis://127.0.0.1:9' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY: missing/,
    )
  })
})
