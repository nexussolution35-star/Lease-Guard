import { Global, Module } from '@nestjs/common'

import { RateLimiter } from './rate-limiter'
import { RedisRateLimiter } from './redis-rate-limiter'

/** The shared rate limiter (Redis counters). Inject `RateLimiter`. */
@Global()
@Module({ providers: [{ provide: RateLimiter, useClass: RedisRateLimiter }], exports: [RateLimiter] })
export class RateLimitModule {}
