import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common'
import { OWNER_SUMMARY_DELIVERY_QUEUE, ownerSummaryDeliveryJobId, type OwnerSummaryDeliveryJob } from '@leaseguard/domain'
import { loggingModule, SERVER_AUTH_OPTIONS, type DbClient } from '@leaseguard/service-kit'
import { createClient } from '@supabase/supabase-js'
import { type DefaultJobOptions, Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

import { ArrearsReportDataService } from '../reports/arrears-report-data.service'
import { saToday } from '../reports/as-of'
import { MonitoringReportDataService } from '../reports/monitoring-report-data.service'
import { OwnerSummaryDataService } from '../reports/owner-summary-data.service'
import { OwnerSummaryService } from '../reports/owner-summary.service'
import { ReportDataService } from '../reports/report-data.service'
import { SecurityReportDataService } from '../reports/security-report-data.service'
import {
  companyOwnerSummaryJobId,
  dispatchOwnerSummaries,
  OWNER_SUMMARY_COMPANY_QUEUE,
  OWNER_SUMMARY_DISPATCH_QUEUE,
  OWNER_SUMMARY_DISPATCH_SCHEDULE,
  runCompanyOwnerSummaries,
  type CompanyOwnerSummaryJob,
} from './owner-summary-run'
import { SupabaseOwnerSummaryStore } from './owner-summary-store'
import type { ReportsWorkerEnv } from './worker-env'

export const REPORTS_WORKER_ENV = Symbol('REPORTS_WORKER_ENV')

/** Retries with exponential backoff, as the core's queues (30 s, 1 min, 2 min, 4 min); bounded history. */
export const REPORTS_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
}

/** The worker's one service-role client. It bypasses RLS: every call names the company. */
@Injectable()
export class ReportsWorkerDatabase {
  private client: DbClient | undefined

  constructor(@Inject(REPORTS_WORKER_ENV) private readonly env: ReportsWorkerEnv) {}

  get(): DbClient {
    this.client ??= createClient(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY, { auth: SERVER_AUTH_OPTIONS })
    return this.client
  }
}

/**
 * The reports worker's queues and BullMQ workers: the daily dispatch (a job scheduler, idempotent across replicas),
 * one job per company and week, and the producer of the core's `owner-summary-delivery` queue. Redis being down never
 * blocks startup; the process logs and keeps retrying.
 */
@Injectable()
export class OwnerSummaryWorker implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OwnerSummaryWorker.name)
  private readonly connection: Redis
  private readonly dispatchQueue: Queue
  private readonly companyQueue: Queue
  private readonly deliveryQueue: Queue
  private readonly workers: Worker[] = []
  private readonly store: SupabaseOwnerSummaryStore

  constructor(
    @Inject(REPORTS_WORKER_ENV) private readonly env: ReportsWorkerEnv,
    private readonly database: ReportsWorkerDatabase,
    private readonly summaries: OwnerSummaryService,
  ) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
    let logged = false
    const onError = (error: Error): void => {
      if (logged) return
      logged = true
      this.logger.warn(`Redis unavailable, retrying: ${error.message}`)
    }
    this.connection.on('error', onError)
    this.connection.on('ready', () => {
      logged = false
    })
    const options = { connection: this.connection, prefix: env.QUEUE_PREFIX, defaultJobOptions: REPORTS_JOB_OPTIONS }
    this.dispatchQueue = new Queue(OWNER_SUMMARY_DISPATCH_QUEUE, options)
    this.companyQueue = new Queue(OWNER_SUMMARY_COMPANY_QUEUE, options)
    this.deliveryQueue = new Queue(OWNER_SUMMARY_DELIVERY_QUEUE, options)
    for (const queue of [this.dispatchQueue, this.companyQueue, this.deliveryQueue]) queue.on('error', onError)
    this.store = new SupabaseOwnerSummaryStore(() => database.get())
  }

  onModuleInit(): void {
    const worker = <T>(queue: string, handle: (data: T) => Promise<unknown>, concurrency: number): void => {
      const instance = new Worker<T>(queue, async (job) => handle(job.data), { connection: this.connection, prefix: this.env.QUEUE_PREFIX, concurrency })
      instance.on('failed', (job, error) => this.logger.error({ queue, jobId: job?.id, attempt: job?.attemptsMade, error: error.message }, 'Job failed'))
      instance.on('error', (error) => this.logger.warn(`Worker ${queue}: ${error.message}`))
      this.workers.push(instance)
    }
    worker<{ asOf?: string }>(OWNER_SUMMARY_DISPATCH_QUEUE, (data) => this.dispatch(data.asOf ?? saToday(new Date())), 1)
    worker<CompanyOwnerSummaryJob>(OWNER_SUMMARY_COMPANY_QUEUE, (data) => this.runCompany(data), 2)
    this.logger.log(`Processing ${OWNER_SUMMARY_DISPATCH_QUEUE} and ${OWNER_SUMMARY_COMPANY_QUEUE} (prefix "${this.env.QUEUE_PREFIX}")`)
  }

  onApplicationBootstrap(): void {
    const { schedulerId, pattern, tz } = OWNER_SUMMARY_DISPATCH_SCHEDULE
    this.dispatchQueue
      .upsertJobScheduler(schedulerId, { pattern, tz }, { name: 'dispatch', data: {}, opts: { ...REPORTS_JOB_OPTIONS } })
      .then(
        () => this.logger.log(`Scheduled ${schedulerId} at "${pattern}" (${tz})`),
        (error: unknown) => this.logger.error(`Could not register ${schedulerId}: ${error instanceof Error ? error.message : String(error)}`),
      )
  }

  dispatch(asOf: string) {
    return dispatchOwnerSummaries(
      {
        store: this.store,
        enqueue: async (jobs) => {
          await this.companyQueue.addBulk(jobs.map((data) => ({ name: OWNER_SUMMARY_COMPANY_QUEUE, data, opts: { jobId: companyOwnerSummaryJobId(data) } })))
        },
      },
      asOf,
    )
  }

  async runCompany(job: CompanyOwnerSummaryJob) {
    const result = await runCompanyOwnerSummaries(
      {
        compute: (companyId, asOf) => this.summaries.compute(this.database.get(), companyId, asOf),
        store: this.store,
        delivery: { request: (delivery: OwnerSummaryDeliveryJob) => this.requestDelivery(delivery) },
      },
      job,
    )
    this.logger.log(result, 'Weekly owner summaries')
    return result
  }

  /** Asks the core messaging pipeline to send one stored summary; one job per summary (the core's job id). */
  private async requestDelivery(job: OwnerSummaryDeliveryJob): Promise<void> {
    await this.deliveryQueue.add(OWNER_SUMMARY_DELIVERY_QUEUE, job, { jobId: ownerSummaryDeliveryJobId(job) })
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()))
    await Promise.all([this.dispatchQueue.close(), this.companyQueue.close(), this.deliveryQueue.close()])
    // Without a connection there is nothing to flush: quitting would wait for one.
    if (this.connection.status === 'ready') await this.connection.quit()
    else this.connection.disconnect()
  }
}

/** Root module of the reports worker process (no HTTP). */
@Module({})
export class ReportsWorkerModule {
  static register(env: ReportsWorkerEnv): DynamicModule {
    return {
      module: ReportsWorkerModule,
      imports: [loggingModule(env.LOG_LEVEL)],
      providers: [
        { provide: REPORTS_WORKER_ENV, useValue: env },
        ReportsWorkerDatabase,
        ReportDataService,
        ArrearsReportDataService,
        MonitoringReportDataService,
        SecurityReportDataService,
        OwnerSummaryDataService,
        OwnerSummaryService,
        OwnerSummaryWorker,
      ],
    }
  }
}
