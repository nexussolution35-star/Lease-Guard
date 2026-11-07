import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { AppModule } from './app.module'
import { loadApiEnv } from './config/env'

async function bootstrap(): Promise<void> {
  const env = loadApiEnv()
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })
  app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true })
  app.enableShutdownHooks()

  const openApi = new DocumentBuilder()
    .setTitle('LeaseGuard API')
    .setDescription('Commercial lease monitoring and tenant communication. No payment processing.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, openApi), {
    jsonDocumentUrl: 'api/docs-json',
  })

  await app.listen(env.API_PORT)
  new Logger('Bootstrap').log(`LeaseGuard API listening on port ${env.API_PORT}`)
}

void bootstrap()
