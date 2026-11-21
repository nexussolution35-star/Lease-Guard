import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { checkProductionSettings, isLoopbackHost, parseServiceEnv } from './env'

const schema = z
  .object({ NODE_ENV: z.string(), PUBLIC_URL: z.string(), ORIGINS: z.string(), KEY: z.string(), REDIS_URL: z.string() })
  .superRefine((env, ctx) =>
    checkProductionSettings(env, ctx, { httpsUrls: ['PUBLIC_URL'], httpsOriginLists: ['ORIGINS'], requiredSecrets: ['KEY'], passwordedRedisUrls: ['REDIS_URL'] }),
  )

const development = { NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:5173', ORIGINS: 'http://localhost:5173', KEY: '', REDIS_URL: 'redis://127.0.0.1:6379' }
const load = (env: Record<string, string>) => parseServiceEnv('test', schema, env, 'test')

describe('checkProductionSettings', () => {
  it('leaves development and test values alone', () => {
    expect(load(development).KEY).toBe('')
    expect(load({ ...development, NODE_ENV: 'test' }).KEY).toBe('')
  })

  it('accepts public https values in production, including an sslip.io address', () => {
    const env = { NODE_ENV: 'production', PUBLIC_URL: 'https://app.203.0.113.10.sslip.io', ORIGINS: 'https://app.example.co.za, https://app.203.0.113.10.sslip.io', KEY: 'k', REDIS_URL: 'redis://:p@redis:6379' }
    expect(load(env).PUBLIC_URL).toBe('https://app.203.0.113.10.sslip.io')
  })

  it('names every development value production refuses, never the value', () => {
    let message = ''
    try {
      load({ ...development, NODE_ENV: 'production', KEY: ' ', REDIS_URL: 'redis://user-only@redis:6379' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('PUBLIC_URL: must be an https URL in production')
    expect(message).toContain('ORIGINS: every origin must be an https URL in production')
    expect(message).toContain('KEY: must be set in production')
    expect(message).toContain('REDIS_URL: must include the Redis password in production')
    expect(message).not.toContain('user-only')
  })

  it('refuses a loopback host even over https', () => {
    expect(() => load({ NODE_ENV: 'production', PUBLIC_URL: 'https://127.0.0.1', ORIGINS: 'https://app.localhost', KEY: 'k', REDIS_URL: 'redis://:p@redis:6379' })).toThrow(
      /PUBLIC_URL: must not be a loopback address[\s\S]*ORIGINS: every origin must not be a loopback address/,
    )
  })
})

describe('isLoopbackHost', () => {
  it('knows the loopback names', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'app.localhost']) expect(isLoopbackHost(host)).toBe(true)
    for (const host of ['app.example.co.za', 'api.203.0.113.10.sslip.io', 'redis']) expect(isLoopbackHost(host)).toBe(false)
  })
})
