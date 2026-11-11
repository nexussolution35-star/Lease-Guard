import type { EntityId, ISODate, ISODateTime } from '@leaseguard/domain'
import type { DefaultJobOptions } from 'bullmq'

/**
 * Every background queue and the payload its jobs carry. Payloads hold identifiers only: processors
 * load current records themselves (with an explicit company_id filter), so a retried job never acts
 * on stale data. Every company-scoped payload names its company.
 */
export interface JobPayloads {
  /** Extract and validate an uploaded statement through the document-processing service. */
  'statement-processing': { companyId: EntityId; statementId: EntityId }
  /** Daily lease scan: expiry, renewal notice deadlines, guarantees, deposits and escalations. */
  'lease-monitoring': { companyId: EntityId; asOf: ISODate }
  /** Daily arrears ageing of verified statements. */
  'arrears-monitoring': { companyId: EntityId; asOf: ISODate }
  /** Daily scan for arrangement instalments that are coming up or overdue. */
  'arrangement-reminders': { companyId: EntityId; asOf: ISODate }
  /** Deliver one approved, eligible WhatsApp message (retried on transient provider failures). */
  'message-delivery': { companyId: EntityId; communicationId: EntityId }
  /**
   * Daily fan-out (job scheduler, 06:00 Africa/Johannesburg): lists the active companies and enqueues
   * one lease-monitoring, arrears-monitoring and arrangement-reminders job per company.
   *
   * The only payload without a companyId: the job spans every company and writes nothing
   * company-owned itself. Each job it enqueues is company-scoped and carries its own companyId.
   * `asOf` is omitted by the scheduler (the processor then uses today's date in South Africa when the
   * job runs); a manual trigger must pass it, because it forms the job id.
   */
  'monitoring-dispatch': { asOf?: ISODate }
  /**
   * Send one company invitation through Supabase Auth (service role, worker only). Never creates a
   * membership: the invitee joins by accepting. Enqueued by the API when an admin creates or resends one.
   */
  'user-invitations': { companyId: EntityId; invitationId: EntityId }
  /**
   * Verify one business number with Meta before it is connected (token scopes, account, webhook subscription,
   * registration, template sync). Enqueued by the API after Embedded Signup and when a company admin asks to
   * verify again or registers the number. Never carries the registration PIN: the API hands it to the worker
   * through a single-use Redis key (infrastructure/whatsapp/registration-pins.ts), so it never reaches
   * job_runs or the job history.
   */
  'whatsapp-number-verification': { companyId: EntityId; numberId: EntityId }
  /**
   * Route one signed Meta webhook payload (inbound messages) to the companies that own its receiving numbers.
   * Enqueued by the API's public webhook after the signature check. The one payload that is not identifiers
   * only, and has no companyId: the API holds no service-role key and cannot store the payload itself, and
   * the company is only known once the worker has routed it (ADR 0002). The worker stores the payload in
   * whatsapp_webhook_events first; the job is removed from Redis once it completed (`jobOptionsFor`).
   * `payloadSha256` (hex SHA-256 of the raw body) is the job id, so Meta's retries of the same body are one job.
   */
  'whatsapp-webhook': { payloadSha256: string; body: string; receivedAt: ISODateTime }
  /**
   * Run the company's AI agent on one inbound WhatsApp message (ticket 10). Enqueued by the webhook processor for
   * every message it recorded (and again for a duplicate, in case an earlier attempt stopped before enqueueing): the
   * job id and the one run per message (start_whatsapp_agent_run) make repeats harmless.
   */
  'whatsapp-agent': { companyId: EntityId; communicationId: EntityId }
  /**
   * Send one WhatsApp test message (ticket 11): a company admin's approved Meta template from a connected number to a
   * number they entered. Enqueued by the API after request_whatsapp_test_message; Meta's status webhook completes it.
   */
  'whatsapp-test-message': { companyId: EntityId; testMessageId: EntityId }
}

export type QueueName = keyof JobPayloads

/** Queues whose jobs act on one company's records. */
export type CompanyQueueName = { [Q in QueueName]: JobPayloads[Q] extends { companyId: EntityId } ? Q : never }[QueueName]

/** Payload fields that identify one unit of work; they form the deterministic job id. */
const JOB_KEY_FIELDS: { readonly [Q in QueueName]: readonly (keyof JobPayloads[Q] & string)[] } = {
  'statement-processing': ['companyId', 'statementId'],
  'lease-monitoring': ['companyId', 'asOf'],
  'arrears-monitoring': ['companyId', 'asOf'],
  'arrangement-reminders': ['companyId', 'asOf'],
  'message-delivery': ['companyId', 'communicationId'],
  'monitoring-dispatch': ['asOf'],
  'user-invitations': ['companyId', 'invitationId'],
  'whatsapp-number-verification': ['companyId', 'numberId'],
  'whatsapp-webhook': ['payloadSha256'],
  'whatsapp-agent': ['companyId', 'communicationId'],
  'whatsapp-test-message': ['companyId', 'testMessageId'],
}

export const QUEUE_NAMES = Object.keys(JOB_KEY_FIELDS) as QueueName[]

/** The per-company daily monitoring queues the dispatch fans out to. */
export const DAILY_MONITORING_QUEUES = ['lease-monitoring', 'arrears-monitoring', 'arrangement-reminders'] as const satisfies readonly QueueName[]
export type DailyMonitoringQueue = (typeof DAILY_MONITORING_QUEUES)[number]

/** Daily dispatch schedule: 06:00 in South Africa, every day. */
export const MONITORING_DISPATCH_SCHEDULE = {
  schedulerId: 'daily-monitoring-dispatch',
  pattern: '0 6 * * *',
  tz: 'Africa/Johannesburg',
} as const

/** The company a payload belongs to; undefined for the system-level dispatch and webhook routing. */
export function companyIdOf(payload: JobPayloads[QueueName]): EntityId | undefined {
  return 'companyId' in payload ? payload.companyId : undefined
}

/**
 * Deterministic job id: enqueueing the same unit of work twice yields one job. Key values are uuids and
 * ISO dates, so they are lowercased: an id given as `ABC…` (route params accept uppercase uuids) names
 * the same record as `abc…` and must not create a second job (e.g. a second WhatsApp send). Values are
 * URI-encoded because BullMQ rejects custom ids containing ':'. Throws when a key field is missing, so
 * an id can never silently become e.g. `monitoring-dispatch.undefined`.
 */
export function jobIdFor<Q extends QueueName>(queue: Q, payload: JobPayloads[Q]): string {
  const keys = JOB_KEY_FIELDS[queue].map((field) => {
    const value: unknown = payload[field]
    if (value === undefined || value === null || value === '') {
      throw new Error(`Cannot derive a job id for ${queue}: "${field}" is missing`)
    }
    return encodeURIComponent(String(value).toLowerCase())
  })
  return [queue, ...keys].join('.')
}

/**
 * Redis key the worker sets once a job id has completed, so a re-delivered copy is skipped
 * (`createIdempotentWorker`). A completed job that is deliberately run again must have it removed.
 */
export function processedMarkerKey(prefix: string, queue: QueueName, jobId: string): string {
  return `${prefix}:processed:${queue}:${jobId}`
}

/** Retries with exponential backoff (30 s, 1 min, 2 min, 4 min); bounded history for inspection. */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
}

/**
 * The default options of one queue. A webhook payload carries message text and phone numbers: once the worker
 * has stored it in the database, the completed job is removed from Redis instead of being kept for a week (a
 * retry of the same body after that is skipped by the processed marker and the payload's unique hash).
 */
export function jobOptionsFor(queue: QueueName): DefaultJobOptions {
  return queue === 'whatsapp-webhook' ? { ...DEFAULT_JOB_OPTIONS, removeOnComplete: true } : DEFAULT_JOB_OPTIONS
}
