import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { Redis } from 'ioredis'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { counterKey, decide, RateLimiter, type RateLimitDecision, type RateLimitRule } from './rate-limiter'

const COMMAND_TIMEOUT_MS = 2_000

/**
 * Fixed-window counters in Redis (INCR + EXPIRE in one MULTI per request), so limits hold across API replicas.
 * Keys live under the queue prefix and expire with their window.
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
    const now = Date.now()
    const transaction = this.redis.multi()
    for (const rule of rules) {
      const key = counterKey(this.env.QUEUE_PREFIX, rule, subject, now)
      transaction.incr(key).expire(key, rule.windowSeconds + 1)
    }
    const results = await transaction.exec()
    if (!results) throw new Error('The rate-limit transaction was discarded')
    const counts = rules.map((_, index) => {
      const [error, value] = results[index * 2] ?? [new Error('missing result'), null]
      if (error) throw error
      return Number(value)
    })
    return decide(rules, counts, now)
  }
}
