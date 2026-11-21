/**
 * The e2e suite's statement worker: the real compiled processors for statement processing and for the monitoring that
 * follows a verification (`statement-monitoring`, which runs the arrears and lease scans for that statement's tenant),
 * consuming the e2e API's queue prefix on the local Redis with the local stack's service role. Built by hand from the
 * API build in backend/.dev-e2e exactly as WorkersModule wires them, and nothing else: no daily monitoring dispatch,
 * no message delivery, no WhatsApp or invitation processors, so no other spec's records are touched by a worker.
 * Started and stopped by run-api.ts; its output goes to tests/test-results/e2e/worker.log.
 *
 * Every setting comes from backend/.env.example plus the overrides run-api.ts passes in LEASEGUARD_E2E_WORKER_ENV:
 * backend/.env is never read.
 *
 * Run by Node directly (type stripping): `node tests/e2e/support/statement-worker.ts`.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { BACKEND_ROOT, REPO_ROOT } from '../../fixtures/paths.ts'

import { STATEMENT_WORKER_ENV_VARIABLE } from './env.ts'

interface Startable {
  onModuleInit(): void
}
interface Runtime {
  beforeApplicationShutdown(): Promise<void>
}
interface Queues {
  onApplicationShutdown(): Promise<void>
}
type Constructor<T = object> = new (...args: unknown[]) => T

function main(): void {
  const raw = process.env[STATEMENT_WORKER_ENV_VARIABLE]
  if (!raw) throw new Error(`${STATEMENT_WORKER_ENV_VARIABLE} is not set: run-api.ts starts this worker`)
  const { buildDir, overrides } = JSON.parse(raw) as { buildDir: string; overrides: Record<string, string> }

  // The compiled backend (CommonJS, decorators already applied) from the e2e API build.
  const fromBuild = createRequire(path.join(BACKEND_ROOT, buildDir, 'worker.js'))
  const load = <T>(file: string, name: string): T => {
    const module = fromBuild(`./${file}`) as Record<string, unknown>
    if (!(name in module)) throw new Error(`backend/${buildDir}/${file} does not export ${name}`)
    return module[name] as T
  }

  const config = fromBuild('./config/env.js') as { WORKER_ENV_KEYS: readonly string[]; loadWorkerEnv(source: NodeJS.ProcessEnv): Record<string, unknown> }
  const example = parseEnv(readFileSync(path.join(REPO_ROOT, 'backend', '.env.example'), 'utf8'))
  const source: Record<string, string> = {}
  for (const key of config.WORKER_ENV_KEYS) source[key] = overrides[key] ?? example[key] ?? ''
  const env = config.loadWorkerEnv(source) as Record<string, string> & object

  const WorkerQueues = load<Constructor<Queues>>('workers/queues/worker-queues.js', 'WorkerQueues')
  const ServiceRoleClientFactory = load<Constructor>('infrastructure/database/service-role-client.factory.js', 'ServiceRoleClientFactory')
  const JobRunRecorderService = load<Constructor>('workers/jobs/job-run-recorder.js', 'JobRunRecorderService')
  const ProcessorRuntime = load<Constructor<Runtime>>('workers/jobs/processor-runtime.js', 'ProcessorRuntime')
  const Clock = load<Constructor>('workers/shared/clock.js', 'Clock')
  const StatementFiles = load<Constructor>('workers/shared/statement-files.js', 'StatementFiles')
  const DocumentProcessingClient = load<Constructor>('infrastructure/document-processing/document-processing.client.js', 'DocumentProcessingClient')
  const StatementProcessingProcessor = load<Constructor<Startable>>('workers/statements/statement-processing.processor.js', 'StatementProcessingProcessor')
  const ArrearsMonitoringProcessor = load<Constructor<Startable>>('workers/monitoring/arrears-monitoring.processor.js', 'ArrearsMonitoringProcessor')
  const LeaseMonitoringProcessor = load<Constructor<Startable>>('workers/monitoring/lease-monitoring.processor.js', 'LeaseMonitoringProcessor')
  const StatementMonitoringProcessor = load<Constructor<Startable>>('workers/monitoring/statement-monitoring.processor.js', 'StatementMonitoringProcessor')

  const queues = new WorkerQueues(env)
  const clients = new ServiceRoleClientFactory(env)
  const clock = new Clock()
  const runtime = new ProcessorRuntime(queues, new JobRunRecorderService(clients), env)
  const extractor = new DocumentProcessingClient({ baseUrl: env.DOCUMENT_PROCESSING_URL, token: env.DOCUMENT_PROCESSING_TOKEN })
  // The arrears and lease processors are only used through statement-monitoring here: their own (daily) queues are
  // not consumed, so they are constructed without onModuleInit.
  const arrears = new ArrearsMonitoringProcessor(runtime, clients)
  const leases = new LeaseMonitoringProcessor(runtime, clients)
  const processors: Startable[] = [
    new StatementProcessingProcessor(runtime, clients, new StatementFiles(clients, env), extractor, clock, env),
    new StatementMonitoringProcessor(runtime, clients, clock, arrears, leases),
  ]
  for (const processor of processors) processor.onModuleInit()
  console.log(`statement worker started (queue prefix ${env.QUEUE_PREFIX})`)

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    try {
      await runtime.beforeApplicationShutdown()
      await queues.onApplicationShutdown()
    } finally {
      console.log('statement worker stopped')
      process.exit(0)
    }
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void stop())
}

main()
