import { InvalidEnvironmentError } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { loadReportsEnv, REPORTS_ENV_KEYS, reportsServiceSettings, SHARED_WITH_CORE_KEYS } from './env'

const VALID = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'public-anon-key',
  REDIS_URL: 'redis://127.0.0.1:6379',
  REPORTS_PORT: '3100',
  REPORTS_CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174',
}

describe('reports configuration', () => {
  it('parses a valid environment and maps it onto the service kit settings', () => {
    const env = loadReportsEnv(VALID)
    expect(env.REPORTS_PORT).toBe(3100)
    expect(env.REPORTS_CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174'])
    expect(reportsServiceSettings(env)).toEqual({
      serviceName: 'reports',
      logLevel: 'info',
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: 'public-anon-key',
      redisUrl: 'redis://127.0.0.1:6379',
    })
  })

  it('defaults its own port and CORS origin for local development', () => {
    const env = loadReportsEnv({ ...VALID, REPORTS_PORT: undefined, REPORTS_CORS_ORIGINS: undefined })
    expect(env.REPORTS_PORT).toBe(3100)
    expect(env.REPORTS_CORS_ORIGINS).toEqual(['http://localhost:5173'])
  })

  it('names every missing or invalid variable, never a value', () => {
    let error: unknown
    try {
      loadReportsEnv({ ...VALID, REPORTS_PORT: 'not-a-port', REDIS_URL: undefined })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(InvalidEnvironmentError)
    const message = (error as Error).message
    expect(message).toContain('REDIS_URL: missing')
    expect(message).toContain('REPORTS_PORT:')
    expect(message).not.toContain('public-anon-key')
  })

  it('reads only its own variables and never a core secret such as the service-role key', () => {
    expect([...REPORTS_ENV_KEYS].sort()).toEqual(
      ['LOG_LEVEL', 'NODE_ENV', 'REDIS_URL', 'REPORTS_CORS_ORIGINS', 'REPORTS_PORT', 'SUPABASE_ANON_KEY', 'SUPABASE_URL'].sort(),
    )
    expect(SHARED_WITH_CORE_KEYS).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(SHARED_WITH_CORE_KEYS.every((key) => REPORTS_ENV_KEYS.includes(key))).toBe(true)
  })

  it('refuses development values in production: plain http, loopback origins, no anon key, Redis without a password', () => {
    const production = {
      ...VALID,
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      REDIS_URL: 'redis://:redis-password@redis:6379',
      REPORTS_CORS_ORIGINS: 'https://app.203.0.113.10.sslip.io',
    }
    expect(loadReportsEnv(production).REPORTS_CORS_ORIGINS).toEqual(['https://app.203.0.113.10.sslip.io'])
    // Production must name the app's origin: the development default (http://localhost:5173) is refused.
    expect(() => loadReportsEnv({ ...production, REPORTS_CORS_ORIGINS: undefined })).toThrow(/REPORTS_CORS_ORIGINS: missing/)
    expect(() => loadReportsEnv({ ...production, REPORTS_CORS_ORIGINS: 'http://localhost:5173' })).toThrow(/REPORTS_CORS_ORIGINS: every origin must be an https URL/)
    const load = () => loadReportsEnv({ ...production, SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: '', REDIS_URL: 'redis://redis:6379' })
    expect(load).toThrow(/SUPABASE_URL: must be an https URL in production/)
    expect(load).toThrow(/SUPABASE_ANON_KEY: must be set in production/)
    expect(load).toThrow(/REDIS_URL: must include the Redis password in production/)
  })
})
