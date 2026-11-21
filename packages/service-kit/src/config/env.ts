import { existsSync, readFileSync } from 'node:fs'
import { parseEnv as parseEnvFile } from 'node:util'
import { z } from 'zod'

/**
 * Configuration helpers every service uses: each service declares its own zod schema (least privilege: a process
 * reads only the variables its schema names) and validates it once at startup with `parseServiceEnv`.
 */

/** pino levels. The Python service maps these to its own logging levels, so one value serves both. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** An optional setting: unset, empty and blank all mean "not configured" (.env.example files ship them empty). */
export const optionalSetting = <T extends z.ZodType<string | undefined>>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional())

/** The variables every HTTP service reads: the runtime, logging, Supabase (anon key only) and Redis. */
export const serviceEnvShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(LOG_LEVELS),
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  /** May be empty until the local Supabase stack is started; the service then reports itself not ready. */
  SUPABASE_ANON_KEY: z.string(),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
}

export const portSetting = z.coerce.number().int().min(1).max(65535)

/** Comma-separated browser origins allowed by CORS. */
export const corsOriginsSetting = z
  .string()
  .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(z.array(z.url()).min(1))

export class InvalidEnvironmentError extends Error {
  /**
   * @param where tells the operator where the settings come from, e.g.
   *   `set these in /path/backend/.env or the process environment; see backend/.env.example`.
   */
  constructor(processName: string, missing: string[], invalid: string[], where: string) {
    const lines = [...missing.map((name) => `  ${name}: missing`), ...invalid]
    super(`Invalid LeaseGuard ${processName} configuration (${where}):\n${lines.join('\n')}`)
    this.name = 'InvalidEnvironmentError'
  }
}

/** Validates `source` with `schema`; throws InvalidEnvironmentError naming every missing or invalid variable, never a value. */
export function parseServiceEnv<S extends z.ZodType>(processName: string, schema: S, source: NodeJS.ProcessEnv, where: string): z.infer<S> {
  const parsed = schema.safeParse(source)
  if (parsed.success) return parsed.data
  const missing = new Set<string>()
  const invalid: string[] = []
  for (const issue of parsed.error.issues) {
    const name = issue.path.join('.')
    if (source[name] === undefined) missing.add(name)
    else invalid.push(`  ${name}: ${issue.message}`)
  }
  throw new InvalidEnvironmentError(processName, [...missing], invalid, where)
}

/**
 * Copies only `keys` (and keys matching `keyPattern`) from an env file into `target`, never overriding values already set.
 *
 * Least privilege: a shared env file can also hold secrets other processes need (for example the service-role key,
 * which only the core worker may hold). Each process imports just the variables its own schema declares.
 */
export function loadEnvFileKeys(file: string, keys: readonly string[], target: NodeJS.ProcessEnv = process.env, keyPattern?: RegExp): void {
  if (!existsSync(file)) return
  const values = parseEnvFile(readFileSync(file, 'utf8'))
  const wanted = new Set(keys)
  for (const [key, value] of Object.entries(values)) {
    if (!wanted.has(key) && !keyPattern?.test(key)) continue
    if (target[key] === undefined && value !== undefined) target[key] = value
  }
}
