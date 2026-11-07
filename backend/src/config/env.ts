import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

/** Repository-root `.env`, shared by every LeaseGuard process. Process env always wins. */
const ROOT_ENV_FILE = resolve(__dirname, '../../../.env')

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
})

export type ApiEnv = z.infer<typeof apiEnvSchema>

/** Load and validate API configuration, failing fast with every invalid variable listed. */
export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  if (source === process.env && existsSync(ROOT_ENV_FILE)) {
    loadDotenv({ path: ROOT_ENV_FILE, quiet: true })
  }
  const parsed = apiEnvSchema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid LeaseGuard API configuration:\n${problems.join('\n')}`)
  }
  return parsed.data
}
