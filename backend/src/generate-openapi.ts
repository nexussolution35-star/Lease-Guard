import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { loadApiEnv } from './config/env'
import { API_PREFIX, createOpenApiDocument, UNPREFIXED_ROUTES } from './openapi'

/**
 * Writes backend/openapi.json without starting the server: providers are constructed but lifecycle
 * hooks never run, so Redis and Supabase need not be reachable.
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule.register(loadApiEnv()), { logger: false, abortOnError: false })
  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES })
  const target = resolve(__dirname, '../openapi.json')
  writeFileSync(target, `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`)
  await app.close()
  console.log(`Wrote ${target}`)
}

generate().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
