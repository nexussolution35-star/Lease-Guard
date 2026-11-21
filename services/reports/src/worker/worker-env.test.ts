import { describe, expect, it } from 'vitest'

import { loadReportsWorkerEnv } from './worker-env'

const VALID = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  REDIS_URL: 'redis://127.0.0.1:6379',
  QUEUE_PREFIX: 'leaseguard',
}

describe('reports worker configuration', () => {
  it('accepts local development values', () => {
    expect(loadReportsWorkerEnv(VALID).QUEUE_PREFIX).toBe('leaseguard')
  })

  it('refuses plain-http Supabase and Redis without a password in production', () => {
    const production = { ...VALID, NODE_ENV: 'production', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', REDIS_URL: 'redis://:secret@redis:6379' }
    expect(loadReportsWorkerEnv(production).NODE_ENV).toBe('production')
    const load = () => loadReportsWorkerEnv({ ...production, SUPABASE_URL: 'http://127.0.0.1:54321', REDIS_URL: 'redis://redis:6379' })
    expect(load).toThrow(/SUPABASE_URL: must be an https URL in production/)
    expect(load).toThrow(/REDIS_URL: must include the Redis password in production/)
  })
})
