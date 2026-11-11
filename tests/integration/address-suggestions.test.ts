import { COMPANY_ID_HEADER } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { RedisRateLimiter } from '../../backend/src/infrastructure/rate-limit/redis-rate-limiter.ts'
import type { ApiEnv } from '../../backend/src/config/env.ts'
import { integration } from './support/clients.ts'

/**
 * Address suggestions through the real API. The suite's API runs with backend/.env.example, which has no Google key,
 * so the feature reports itself unavailable and never calls Google; the limiter is proven against the real Redis.
 */
const post = (path: string, body: unknown, token: string | null = integration().accessTokens.manager) =>
  fetch(`${integration().apiBaseUrl}/api/v1/address-suggestions${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

const TOKEN = '6f1d2c1e-0000-4000-8000-000000000001'

describe('address suggestions API', () => {
  it('needs a signed-in user', async () => {
    expect((await fetch(`${integration().apiBaseUrl}/api/v1/address-suggestions/status`)).status).toBe(401)
    expect((await post('', { input: 'Sandton', sessionToken: TOKEN }, null)).status).toBe(401)
  })

  it('says it is unavailable without a server key, and refuses lookups with 503 without calling Google', async () => {
    const status = await fetch(`${integration().apiBaseUrl}/api/v1/address-suggestions/status`, {
      headers: { Authorization: `Bearer ${integration().accessTokens.readOnly}`, [COMPANY_ID_HEADER]: integration().world.companies.a.id },
    })
    expect(await status.json()).toEqual({ available: false })

    const search = await post('', { input: 'Sandton City', sessionToken: TOKEN })
    expect(search.status).toBe(503)
    expect((await search.json()).message).toBe('Address suggestions are not set up. Type the address in full.')
    expect(search.headers.get('cache-control')).toBe('no-store')
  })

  it('validates the request (400)', async () => {
    const short = await post('', { input: 'ab', sessionToken: TOKEN })
    expect(short.status).toBe(400)
    const badToken = await post('/resolve', { placeId: 'ChIJ abc', sessionToken: 'x' })
    expect(badToken.status).toBe(400)
  })
})

describe('RedisRateLimiter against the real Redis', () => {
  it('allows up to the limit in a window, refuses the next with the wait, and keeps subjects apart', async () => {
    const env = { REDIS_URL: integration().redisUrl, QUEUE_PREFIX: `${integration().queuePrefix}-ratelimit` } as ApiEnv
    const limiter = new RedisRateLimiter(env)
    limiter.onApplicationBootstrap()
    try {
      const rules = [{ name: 'it-search-minute', limit: 30, windowSeconds: 60 }]
      const subject = `user-${integration().runId}`
      const decisions = []
      for (let i = 0; i < 31; i += 1) decisions.push(await limiter.consume(subject, rules))
      expect(decisions.slice(0, 30).every((d) => d.allowed)).toBe(true)
      const refused = decisions[30]!
      expect(refused.allowed).toBe(false)
      expect(!refused.allowed && refused.retryAfterSeconds).toBeGreaterThanOrEqual(1)
      expect(!refused.allowed && refused.retryAfterSeconds).toBeLessThanOrEqual(60)
      // Another user is not affected.
      expect((await limiter.consume(`${subject}-other`, rules)).allowed).toBe(true)
    } finally {
      limiter.onApplicationShutdown()
    }
  })
})
