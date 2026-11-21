import { resolve } from 'node:path'
import {
  corsOriginsSetting,
  loadEnvFileKeys,
  parseServiceEnv,
  portSetting,
  serviceEnvShape,
  type ServiceSettings,
} from '@leaseguard/service-kit'
import { z } from 'zod'

/** `services/reports/.env` (compiled code sits one level below the service root, as in backend/). */
export const REPORTS_ENV_FILE = resolve(__dirname, '../../.env')
/** The core service's env file, read in local development for the shared settings only (see .env.example). */
export const CORE_ENV_FILE = resolve(__dirname, '../../../../backend/.env')

/** Development defaults, so `pnpm dev` runs the service without a services/reports/.env (see .env.example). */
export const DEFAULT_REPORTS_PORT = 3100
const DEFAULT_CORS_ORIGINS = 'http://localhost:5173'

const reportsEnvObject = z.object({
  ...serviceEnvShape,
  REPORTS_PORT: z.preprocess((value) => value ?? String(DEFAULT_REPORTS_PORT), portSetting),
  // Safe outside development too: an unset value only lets the local dev server call the service.
  REPORTS_CORS_ORIGINS: z.preprocess((value) => value ?? DEFAULT_CORS_ORIGINS, corsOriginsSetting),
})

export type ReportsEnv = z.infer<typeof reportsEnvObject>

/** Every variable the reports service reads. It never reads the service-role key or any other core secret. */
export const REPORTS_ENV_KEYS: readonly string[] = Object.keys(reportsEnvObject.shape)
/** The settings it may take from backend/.env when its own file and the environment lack them. */
export const SHARED_WITH_CORE_KEYS: readonly string[] = Object.keys(serviceEnvShape)

/** Reports configuration. Throws InvalidEnvironmentError listing every missing or invalid variable. */
export function loadReportsEnv(source?: NodeJS.ProcessEnv): ReportsEnv {
  if (!source) {
    loadEnvFileKeys(REPORTS_ENV_FILE, REPORTS_ENV_KEYS)
    loadEnvFileKeys(CORE_ENV_FILE, SHARED_WITH_CORE_KEYS)
  }
  return parseServiceEnv(
    'reports',
    reportsEnvObject,
    source ?? process.env,
    `set these in ${REPORTS_ENV_FILE} or the process environment; see services/reports/.env.example`,
  )
}

/** What the shared service kit needs from this configuration. */
export function reportsServiceSettings(env: ReportsEnv): ServiceSettings {
  return {
    serviceName: 'reports',
    logLevel: env.LOG_LEVEL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    redisUrl: env.REDIS_URL,
  }
}
