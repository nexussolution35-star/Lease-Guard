import { Redis } from 'ioredis'

/** Redis connection for BullMQ workers. Workers block on Redis, so commands must not give up after retries. */
export function createQueueConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null })
}

/**
 * Redis connection for producers in the API process. Commands queue briefly while connecting but give
 * up after one reconnection attempt, so an HTTP request gets a 503 instead of waiting for Redis.
 */
export function createProducerConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: 1 })
}
