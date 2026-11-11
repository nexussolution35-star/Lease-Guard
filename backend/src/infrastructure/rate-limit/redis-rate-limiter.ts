import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { Redis } from 'ioredis'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { counterKey, decide, RateLimiter, type RateLimitDecision, type RateLimitRule } from './rate-limiter'

const COMMAND_TIMEOUT_MS = 2_000

/**
 * Check-then-count in one atomic step: KEYS are the counters, ARGV the limits then the windows (seconds). Returns the
 * counts before this use; the use is counted (INCR + EXPIRE on every key) only when every count is under its limit.
 */
const CHECK_AND_COUNT = `
local n = #KEYS
local counts = {}
local allowed = true
for i = 1, n do
  counts[i] = tonumber(redis.call('GET', KEYS[i]) or '0')
  if counts[i] >= tonumber(ARGV[i]) then allowed = false end
end
if allowed then
  for i = 1, n do
    redis.call('INCR', KEYS[i])
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[n + i]))
  end
end
return counts
`

/**
 * Fixed-window counters in Redis, so limits hold across API replicas. A refused use is not counted (one Lua script
 * checks every counter before counting any). Keys live under the queue prefix and expire with their window.
 */
@Injectable()
export class RedisRateLimiter extends RateLimiter implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly redis: Redis

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    super()
    this.redis = new Redis(env.REDIS_URL, {
      // Connect on bootstrap, not on construction, so building the OpenAPI document needs no Redis.
      lazyConnect: true,
      // While connecting (start-up, a brief reconnect) commands wait, up to COMMAND_TIMEOUT_MS, instead of failing at
      // once; a longer outage still fails, and the caller refuses the request (fail closed).
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
      connectTimeout: COMMAND_TIMEOUT_MS,
      commandTimeout: COMMAND_TIMEOUT_MS,
      retryStrategy: (attempt) => Math.min(attempt * 1000, 10_000),
    })
    // Readiness reports Redis outages; a failed count surfaces as an error from consume().
    this.redis.on('error', () => undefined)
  }

  onApplicationBootstrap(): void {
    this.redis.connect().catch(() => undefined)
  }

  onApplicationShutdown(): void {
    this.redis.disconnect()
  }

  async consume(subject: string, rules: readonly RateLimitRule[]): Promise<RateLimitDecision> {
    if (rules.length === 0) return { allowed: true }
    const now = Date.now()
    const keys = rules.map((rule) => counterKey(this.env.QUEUE_PREFIX, rule, subject, now))
    const args = [...rules.map((rule) => String(rule.limit)), ...rules.map((rule) => String(rule.windowSeconds + 1))]
    const result: unknown = await this.redis.eval(CHECK_AND_COUNT, keys.length, ...keys, ...args)
    if (!Array.isArray(result) || result.length !== rules.length) throw new Error('Unexpected rate-limit script result')
    return decide(rules, result.map(Number), now)
  }
}
