import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { API_PREFIX, UNPREFIXED_ROUTES } from '@leaseguard/service-kit'

import { ReportsAppModule } from './app.module'
import { loadReportsEnv } from './config/env'
import { createReportsOpenApiDocument } from './openapi'

/**
 * Writes services/reports/openapi.json without starting the server: providers are constructed but lifecycle hooks
 * never run, so Redis and Supabase need not be reachable.
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(ReportsAppModule.register(loadReportsEnv()), { logger: false, abortOnError: false })
  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES })
  const target = resolve(__dirname, '../openapi.json')
  writeFileSync(target, `${JSON.stringify(createReportsOpenApiDocument(app), null, 2)}\n`)
  await app.close()
  console.log(`Wrote ${target}`)
}

generate().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
