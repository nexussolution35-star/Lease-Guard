import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { TooManyRequestsException } from '../../common/http/too-many-requests.exception'
import type { ApiEnv } from '../../config/env'
import { RateLimiter, type RateLimitDecision, type RateLimitRule } from '../../infrastructure/rate-limit/rate-limiter'
import { addressSearchBodySchema } from './address-suggestions.schemas'
import { AddressSuggestionsService, RESOLVE_RULES, SEARCH_RULES } from './address-suggestions.service'
import { GooglePlacesUnavailableError, type GooglePlacesClient } from './google-places.client'

const USER = '7d9f3c2a-0000-5000-8000-000000000001'
const TOKEN = '6f1d2c1e-0000-4000-8000-000000000001'
const env = { ADDRESS_LOOKUP_DAILY_LIMIT: 5000 } as ApiEnv

class FakeLimiter extends RateLimiter {
  calls: { subject: string; rules: readonly RateLimitRule[] }[] = []
  constructor(private readonly decide: (subject: string) => RateLimitDecision | Error = () => ({ allowed: true })) {
    super()
  }
  async consume(subject: string, rules: readonly RateLimitRule[]): Promise<RateLimitDecision> {
    this.calls.push({ subject, rules })
    const decision = this.decide(subject)
    if (decision instanceof Error) throw decision
    return decision
  }
}

function places(overrides: Partial<GooglePlacesClient> = {}) {
  return {
    configured: true,
    autocomplete: vi.fn(async () => [{ placeId: 'abc', primary: 'Sandton City' }]),
    address: vi.fn(async () => ({ line1: '83 Rivonia Road' })),
    ...overrides,
  } as unknown as GooglePlacesClient
}

const body = { input: 'Sandton', sessionToken: TOKEN }

describe('AddressSuggestionsService', () => {
  it('counts a search for the user and for the deployment before asking Google', async () => {
    const limiter = new FakeLimiter()
    const client = places()
    const service = new AddressSuggestionsService(client, limiter, env)
    expect(await service.search(USER, body)).toEqual([{ placeId: 'abc', primary: 'Sandton City' }])
    expect(limiter.calls).toEqual([
      { subject: USER, rules: SEARCH_RULES },
      { subject: 'all-users', rules: [{ name: 'address-lookup-deployment-day', limit: 5000, windowSeconds: 86_400 }] },
    ])

    await service.resolve(USER, { placeId: 'abc', sessionToken: TOKEN })
    expect(limiter.calls[2]).toEqual({ subject: USER, rules: RESOLVE_RULES })
  })

  it('refuses over a user limit with 429 and the wait, without calling Google', async () => {
    const client = places()
    const service = new AddressSuggestionsService(client, new FakeLimiter((s) => (s === USER ? { allowed: false, retryAfterSeconds: 37, rule: 'address-search-minute' } : { allowed: true })), env)
    const refusal = await service.search(USER, body).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(TooManyRequestsException)
    expect((refusal as TooManyRequestsException).retryAfterSeconds).toBe(37)
    expect(client.autocomplete).not.toHaveBeenCalled()
  })

  it('refuses when the deployment reached its daily limit', async () => {
    const service = new AddressSuggestionsService(places(), new FakeLimiter((s) => (s === 'all-users' ? { allowed: false, retryAfterSeconds: 3600, rule: 'x' } : { allowed: true })), env)
    await expect(service.search(USER, body)).rejects.toThrow("Address suggestions have reached today's limit")
  })

  it('fails closed (503) when the counters cannot be reached, and never calls Google uncounted', async () => {
    const client = places()
    const service = new AddressSuggestionsService(client, new FakeLimiter(() => new Error('Connection is closed')), env)
    await expect(service.search(USER, body)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(client.autocomplete).not.toHaveBeenCalled()
  })

  it('answers 503 when not set up or when Google is unavailable', async () => {
    const off = new AddressSuggestionsService(places({ configured: false } as Partial<GooglePlacesClient>), new FakeLimiter(), env)
    expect(off.status()).toEqual({ available: false })
    await expect(off.search(USER, body)).rejects.toThrow('Address suggestions are not set up')

    const down = new AddressSuggestionsService(places({ autocomplete: vi.fn(async () => Promise.reject(new GooglePlacesUnavailableError('x'))) } as Partial<GooglePlacesClient>), new FakeLimiter(), env)
    await expect(down.search(USER, body)).rejects.toThrow('Address suggestions are unavailable right now')
  })

  it('validates the request: at least three characters and a URL-safe session token', () => {
    expect(addressSearchBodySchema.safeParse({ input: ' ab ', sessionToken: TOKEN }).success).toBe(false)
    expect(addressSearchBodySchema.safeParse({ input: 'Sandton', sessionToken: 'has spaces and is long enough' }).success).toBe(false)
    expect(addressSearchBodySchema.safeParse({ input: 'Sandton', sessionToken: TOKEN, key: 'x' }).success).toBe(false)
  })
})
