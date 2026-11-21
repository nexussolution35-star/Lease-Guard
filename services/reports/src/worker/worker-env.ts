import { checkProductionSettings, LOG_LEVELS, loadEnvFileKeys, parseServiceEnv } from '@leaseguard/service-kit'
import { z } from 'zod'

import { CORE_ENV_FILE, REPORTS_ENV_FILE } from '../config/env'

/**
 * The reports worker's configuration (services/reports/src/worker.ts, ticket R-07). The worker is a separate process
 * from the reports HTTP service: the HTTP service holds the anon key only and reads with the caller's token, while
 * the worker computes every company's weekly owner summaries on a schedule, without a caller, so it holds the
 * service-role key, as the core worker does. It reads company data only through the reports_* functions (naming the
 * company), writes only reports_* tables and asks the core messaging pipeline to send by queue.
 */
const workerEnvObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(LOG_LEVELS),
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'the service-role key (the reports worker only, never the reports HTTP service)'),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** The core's BullMQ key prefix: the owner-summary-delivery queue the core worker consumes lives under it. */
  QUEUE_PREFIX: z.preprocess((value) => value ?? 'leaseguard', z.string().regex(/^[a-z0-9_-]+$/i, 'letters, digits, "-" and "_" only')),
})

/** Production refuses plain-http Supabase and Redis without a password. */
const workerEnvSchema = workerEnvObject.superRefine((env, ctx) =>
  checkProductionSettings(env, ctx, { httpsUrls: ['SUPABASE_URL'], passwordedRedisUrls: ['REDIS_URL'] }),
)

export type ReportsWorkerEnv = z.infer<typeof workerEnvSchema>

export const REPORTS_WORKER_ENV_KEYS: readonly string[] = Object.keys(workerEnvObject.shape)

/** Reports worker configuration; in local development the missing settings are read from backend/.env. */
export function loadReportsWorkerEnv(source?: NodeJS.ProcessEnv): ReportsWorkerEnv {
  if (!source) {
    loadEnvFileKeys(REPORTS_ENV_FILE, REPORTS_WORKER_ENV_KEYS)
    loadEnvFileKeys(CORE_ENV_FILE, REPORTS_WORKER_ENV_KEYS)
  }
  return parseServiceEnv(
    'reports worker',
    workerEnvSchema,
    source ?? process.env,
    `set these in ${REPORTS_ENV_FILE} or the process environment; see services/reports/.env.example`,
  )
}
