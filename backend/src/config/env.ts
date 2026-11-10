import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv as parseEnvFile } from 'node:util'
import { z } from 'zod'

import { WHATSAPP_ACCESS_TOKEN_KEY } from '../infrastructure/whatsapp/access-token-reference'

/** Repository-root `.env`, shared by every LeaseGuard process. Variables already set in the process win. */
export const ROOT_ENV_FILE = resolve(__dirname, '../../../.env')

/** pino levels. The Python service maps these to its own logging levels, so one value serves both. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

// BullMQ separates key segments with ':', so the prefix must not contain one.
const queuePrefix = z.string().regex(/^[a-z0-9_-]+$/i, 'letters, digits, "-" and "_" only')
// Storage bucket ids as created by supabase/migrations/*_storage.sql.
const bucketId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase letters, digits and "-"')

/** An optional setting: unset, empty and blank all mean "not configured" (.env.example ships them empty). */
const optionalSetting = <T extends z.ZodType<string | undefined>>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional())
const optionalText = optionalSetting(z.string())
/** Meta object ids (app, configuration) are numeric. */
const optionalMetaId = optionalSetting(z.string().trim().regex(/^[0-9]{1,32}$/, 'a numeric Meta id'))

const sharedSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(LOG_LEVELS),
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  QUEUE_PREFIX: queuePrefix,
  SUPABASE_STATEMENTS_BUCKET: bucketId,
  SUPABASE_LEASE_DOCUMENTS_BUCKET: bucketId,
  /** Largest statement PDF accepted, in MiB. The storage bucket enforces its own limit as well. */
  DOCUMENT_PROCESSING_MAX_FILE_MB: z.coerce.number().int().min(1).max(200),
})

const apiEnvSchema = sharedSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65535),
  API_CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.url()).min(1)),
  /** May be empty until the local Supabase stack is started; the API then reports itself not ready. */
  SUPABASE_ANON_KEY: z.string(),
  /**
   * Meta app (WhatsApp Tech Provider) settings. All optional, so local development works without Meta:
   * GET /integrations/whatsapp/capabilities reports which are missing. The app id and the Embedded
   * Signup configuration id are public (the browser passes them to the Facebook SDK); the app secret
   * (code exchange, webhook signatures) and the webhook verify token stay on the API.
   */
  WHATSAPP_APP_ID: optionalMetaId,
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: optionalMetaId,
  WHATSAPP_APP_SECRET: optionalText,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalText,
})

const workerEnvSchema = sharedSchema
  .extend({
    /** May be empty until Supabase is started; workers that need the database then fail clearly. */
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
    DOCUMENT_PROCESSING_URL: z.url({ protocol: /^https?$/ }),
    /** Bearer token shared with the document-processing service. */
    DOCUMENT_PROCESSING_TOKEN: z.string().min(1),
    /** Meta Graph API base URL and version used to send WhatsApp messages. */
    WHATSAPP_GRAPH_API_URL: z.url({ protocol: /^https$/ }),
    WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'a Graph API version such as v23.0'),
    /** Anthropic API key for the AI agent runtime. Optional; worker only (the API never loads it). */
    ANTHROPIC_API_KEY: optionalText,
    /**
     * Public URL of the web app (origin plus optional base path, no trailing slash needed). Invitation
     * emails link to `${WEB_APP_URL}/auth/accept?invitation=<id>`, which the Supabase Auth redirect allow-list must
     * accept (a hosted project needs a pattern such as `https://app.example/auth/accept**`).
     */
    WEB_APP_URL: z
      .url({ protocol: /^https?$/ })
      .refine((value) => !/[?#]/.test(value), 'must not contain a query or fragment')
      .transform((value) => value.replace(/\/+$/, '')),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.WEB_APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['WEB_APP_URL'], message: 'must be an https URL in production' })
    }
    if (env.NODE_ENV === 'production' && env.DOCUMENT_PROCESSING_TOKEN.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['DOCUMENT_PROCESSING_TOKEN'],
        message: 'must be at least 32 characters in production',
      })
    }
  })

export type ApiEnv = z.infer<typeof apiEnvSchema>
export type WorkerEnv = z.infer<typeof workerEnvSchema>

export class InvalidEnvironmentError extends Error {
  constructor(processName: string, missing: string[], invalid: string[]) {
    const lines = [
      ...missing.map((name) => `  ${name}: missing`),
      ...invalid,
    ]
    super(
      `Invalid LeaseGuard ${processName} configuration (set these in ${ROOT_ENV_FILE} or the process environment; see .env.example):\n${lines.join('\n')}`,
    )
    this.name = 'InvalidEnvironmentError'
  }
}

function parseEnv<S extends z.ZodType>(processName: string, schema: S, source: NodeJS.ProcessEnv): z.infer<S> {
  const parsed = schema.safeParse(source)
  if (parsed.success) return parsed.data
  const missing = new Set<string>()
  const invalid: string[] = []
  for (const issue of parsed.error.issues) {
    const name = issue.path.join('.')
    if (source[name] === undefined) missing.add(name)
    else invalid.push(`  ${name}: ${issue.message}`)
  }
  throw new InvalidEnvironmentError(processName, [...missing], invalid)
}

/**
 * Copies only `keys` from an env file into `target`, never overriding values already set.
 *
 * Least privilege: the shared root `.env` also holds secrets other processes need (for example the
 * service-role key, which only the worker may hold). Each process imports just the variables its own
 * schema declares, so the API process never has the service-role key in its environment.
 */
export function loadEnvFileKeys(
  file: string,
  keys: readonly string[],
  target: NodeJS.ProcessEnv = process.env,
  keyPattern?: RegExp,
): void {
  if (!existsSync(file)) return
  const values = parseEnvFile(readFileSync(file, 'utf8'))
  const wanted = new Set(keys)
  for (const [key, value] of Object.entries(values)) {
    if (!wanted.has(key) && !keyPattern?.test(key)) continue
    if (target[key] === undefined && value !== undefined) target[key] = value
  }
}

/**
 * Per-company WhatsApp access tokens held in the worker environment (`secret://env/…` references), one
 * variable per company named after its id: `WHATSAPP_ACCESS_TOKEN_<company uuid without dashes,
 * uppercase>`. The pattern comes from the WhatsApp channel module, the one place that knows the
 * reference formats. Only the worker loads them; tokens in Supabase Vault need no variable.
 */
export { WHATSAPP_ACCESS_TOKEN_KEY }

export const API_ENV_KEYS: readonly string[] = Object.keys(apiEnvSchema.shape)
export const WORKER_ENV_KEYS: readonly string[] = Object.keys(workerEnvSchema.shape)

/** API configuration. Throws InvalidEnvironmentError listing every missing or invalid variable. */
export function loadApiEnv(source?: NodeJS.ProcessEnv): ApiEnv {
  if (!source) loadEnvFileKeys(ROOT_ENV_FILE, API_ENV_KEYS)
  return parseEnv('API', apiEnvSchema, source ?? process.env)
}

/** Worker configuration. Needs no API-only variables. */
export function loadWorkerEnv(source?: NodeJS.ProcessEnv): WorkerEnv {
  if (!source) loadEnvFileKeys(ROOT_ENV_FILE, WORKER_ENV_KEYS, process.env, WHATSAPP_ACCESS_TOKEN_KEY)
  return parseEnv('worker', workerEnvSchema, source ?? process.env)
}
