import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { loadWorkerEnv, WORKER_ENV_KEYS } from '../../../backend/src/config/env.ts'
import { ServiceRoleClientFactory } from '../../../backend/src/infrastructure/database/service-role-client.factory.ts'
import { createWhatsAppChannels } from '../../../backend/src/infrastructure/whatsapp/database-whatsapp-channels.ts'
import type { AgentLlm } from '../../../backend/src/messaging/agent-llm.ts'
import { JobRunRecorderService } from '../../../backend/src/workers/jobs/job-run-recorder.ts'
import { ProcessorRuntime } from '../../../backend/src/workers/jobs/processor-runtime.ts'
import { MessageDeliveryProcessor } from '../../../backend/src/workers/messaging/message-delivery.processor.ts'
import { WorkerQueues } from '../../../backend/src/workers/queues/worker-queues.ts'
import { Clock } from '../../../backend/src/workers/shared/clock.ts'
import { StatementFiles } from '../../../backend/src/workers/shared/statement-files.ts'
import { WhatsAppAgentProcessor } from '../../../backend/src/workers/whatsapp/agent-reply.processor.ts'
import { WhatsAppWebhookProcessor } from '../../../backend/src/workers/whatsapp/inbound-webhook.processor.ts'
import { WhatsAppNumberVerificationProcessor } from '../../../backend/src/workers/whatsapp/number-verification.processor.ts'
import { WhatsAppTestMessageProcessor } from '../../../backend/src/workers/whatsapp/test-message.processor.ts'
import { BACKEND_ROOT, REPO_ROOT } from '../../fixtures/paths.ts'

/**
 * The worker's WhatsApp processors (number verification, webhook routing, AI agent, message delivery, test messages)
 * running in THIS process on the real BullMQ queues of one queue prefix, with the worker's real database side
 * (service role, local stack only). Built by hand exactly as WorkersModule wires them, with two seams replaced: the
 * agent's model is the caller's fake (never Anthropic), and the WhatsApp channels talk to the caller's fake Graph API
 * (never Meta). The worker process itself refuses a plain-http Graph URL, so its env gets an unresolvable one and the
 * channels are built with the fake's URL directly. Logs go to `logFile`, not the test output.
 */

export interface InProcessWorkerOptions {
  supabaseUrl: string
  serviceRoleKey: string
  redisUrl: string
  queuePrefix: string
  meta: { appId: string; appSecret: string; graphUrl: string; graphVersion: string }
  llm: AgentLlm
  logFile: string
}

export interface InProcessWorker {
  stop(): Promise<void>
}

/** The structural part of NestJS's LoggerService the file logger implements. */
interface LoggerLike {
  log(message: unknown, ...rest: unknown[]): void
  error(message: unknown, ...rest: unknown[]): void
  warn(message: unknown, ...rest: unknown[]): void
  debug(message: unknown, ...rest: unknown[]): void
  verbose(message: unknown, ...rest: unknown[]): void
}

/** NestJS's Logger, from the backend's own dependency (the processors log through its static instance). */
function nestLogger(): { overrideLogger(logger: LoggerLike | false): void } {
  const requireFromBackend = createRequire(path.join(BACKEND_ROOT, 'package.json'))
  const nest = requireFromBackend('@nestjs/common') as { Logger: { overrideLogger(logger: LoggerLike | false): void } }
  return nest.Logger
}

function fileLogger(file: string): LoggerLike {
  mkdirSync(path.dirname(file), { recursive: true })
  const write = (level: string) => (message: unknown, ...rest: unknown[]) => {
    const line = JSON.stringify({ at: new Date().toISOString(), level, message, rest })
    appendFileSync(file, `${line}\n`)
  }
  return { log: write('info'), error: write('error'), warn: write('warn'), debug: write('debug'), verbose: write('verbose') }
}

/** Every worker setting from backend/.env.example, then the overrides: backend/.env is never read. */
function workerEnvironment(overrides: Readonly<Record<string, string>>): Record<string, string> {
  const example = parseEnv(readFileSync(path.join(REPO_ROOT, 'backend', '.env.example'), 'utf8'))
  const env: Record<string, string> = {}
  for (const key of WORKER_ENV_KEYS) env[key] = overrides[key] ?? example[key] ?? ''
  return env
}

export function startInProcessWorker(options: InProcessWorkerOptions): InProcessWorker {
  nestLogger().overrideLogger(fileLogger(options.logFile))
  const env = loadWorkerEnv(
    workerEnvironment({
      NODE_ENV: 'test',
      SUPABASE_URL: options.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: options.serviceRoleKey,
      REDIS_URL: options.redisUrl,
      QUEUE_PREFIX: options.queuePrefix,
      // Unresolvable on purpose: the channels below use the fake Graph server, nothing may reach Meta.
      WHATSAPP_GRAPH_API_URL: 'https://graph.facebook.invalid',
      WHATSAPP_GRAPH_API_VERSION: options.meta.graphVersion,
      WHATSAPP_APP_ID: options.meta.appId,
      WHATSAPP_APP_SECRET: options.meta.appSecret,
      ANTHROPIC_API_KEY: '',
    }),
  )

  const queues = new WorkerQueues(env)
  const clients = new ServiceRoleClientFactory(env)
  const clock = new Clock()
  const runtime = new ProcessorRuntime(queues, new JobRunRecorderService(clients), env)
  // No env-held tokens: business tokens come from Vault, bound to their company.
  const channels = createWhatsAppChannels(
    clients,
    { apiUrl: options.meta.graphUrl, apiVersion: options.meta.graphVersion },
    {},
    { appId: options.meta.appId, appSecret: options.meta.appSecret },
  )
  const processors = [
    new WhatsAppNumberVerificationProcessor(runtime, clients, channels, clock, queues, env),
    new WhatsAppWebhookProcessor(runtime, clients, channels, clock, env, queues),
    new WhatsAppAgentProcessor(runtime, clients, queues, clock, options.llm),
    new MessageDeliveryProcessor(runtime, clients, channels, new StatementFiles(clients, env), clock),
    new WhatsAppTestMessageProcessor(runtime, clients, channels),
  ]
  for (const processor of processors) processor.onModuleInit()

  return {
    async stop() {
      await runtime.beforeApplicationShutdown()
      await queues.onApplicationShutdown()
      nestLogger().overrideLogger(false)
    },
  }
}
