import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { Redis } from 'ioredis'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import type { DependencyCheck, ReadinessResponse } from './health.responses'

// Hosted Supabase can take over 2 s on a cold first request; 5 s keeps probes meaningful without flapping.
const CHECK_TIMEOUT_MS = 5000

/**
 * Readiness of the API's runtime dependencies. The API boots even when Redis or Supabase is down
 * (local dev before `supabase start`); it reports itself not ready instead of crashing.
 */
@Injectable()
export class ReadinessService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReadinessService.name)
  private readonly redis: Redis
  private redisErrorLogged = false

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.redis = new Redis(env.REDIS_URL, {
      // Connect on bootstrap, not on construction, so building the OpenAPI document needs no Redis.
      lazyConnect: true,
      // Fail fast while disconnected instead of queueing the health ping.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
      retryStrategy: (attempt) => Math.min(attempt * 1000, 10_000),
    })
    this.redis.on('error', (error: Error) => {
      if (this.redisErrorLogged) return
      this.redisErrorLogged = true
      this.logger.warn(`Redis unavailable: ${error.message}`)
    })
    this.redis.on('ready', () => {
      this.redisErrorLogged = false
    })
  }

  onApplicationBootstrap(): void {
    this.redis.connect().catch(() => undefined) // reported through the 'error' listener and readiness
  }

  onApplicationShutdown(): void {
    this.redis.disconnect()
  }

  async check(): Promise<ReadinessResponse> {
    const [redis, supabase] = await Promise.all([this.checkRedis(), this.checkSupabase()])
    const ready = redis.status === 'up' && supabase.status === 'up'
    return { status: ready ? 'ready' : 'not_ready', checks: { redis, supabase } }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const started = performance.now()
    try {
      await withTimeout(this.redis.ping())
      return { status: 'up', latencyMs: elapsed(started) }
    } catch {
      return { status: 'down', reason: 'Redis did not answer PING' }
    }
  }

  /** Supabase is reachable when its Auth service answers through the API gateway with the anon key. */
  private async checkSupabase(): Promise<DependencyCheck> {
    if (!this.env.SUPABASE_ANON_KEY) return { status: 'not_configured', reason: 'SUPABASE_ANON_KEY is not set' }
    const started = performance.now()
    try {
      const response = await fetch(new URL('/auth/v1/health', this.env.SUPABASE_URL), {
        headers: { apikey: this.env.SUPABASE_ANON_KEY },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })
      if (response.ok) return { status: 'up', latencyMs: elapsed(started) }
      this.logger.warn(`Supabase Auth health check answered HTTP ${response.status}`)
      return { status: 'down', reason: `Supabase answered HTTP ${response.status}` }
    } catch (error) {
      this.logger.warn(`Supabase unreachable: ${error instanceof Error ? error.message : String(error)}`)
      return { status: 'down', reason: 'Supabase is unreachable' }
    }
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started)
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref()),
  ])
}
