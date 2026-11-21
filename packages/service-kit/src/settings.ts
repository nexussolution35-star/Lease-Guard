import type { LogLevel } from './config/env'

/**
 * What the kit needs from a service's validated configuration. Each service maps its own environment onto
 * this (the core service from backend/src/config/env.ts, the reports service from services/reports/src/config/env.ts),
 * so the kit never reads the environment itself.
 */
export interface ServiceSettings {
  /** Short name used in logs and the liveness response, e.g. `core` or `reports`. */
  serviceName: string
  logLevel: LogLevel
  supabaseUrl: string
  /** Public anon key. May be empty until the local Supabase stack is started; the service then reports itself not ready. */
  supabaseAnonKey: string
  /** Redis for BullMQ queues (the only channel between services). Readiness pings it. */
  redisUrl: string
}

/** Injection token for the running service's ServiceSettings. */
export const SERVICE_SETTINGS = Symbol('SERVICE_SETTINGS')
