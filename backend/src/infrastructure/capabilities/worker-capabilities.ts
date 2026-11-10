import { z } from 'zod'

/**
 * What the worker process can do, as it reports it to the API through Redis. Some settings belong to
 * the worker alone (least privilege: the API never loads ANTHROPIC_API_KEY), so the API cannot check
 * them itself; the worker publishes booleans only, never a setting's value.
 *
 * Contract: the worker SETs `workerCapabilitiesKey(QUEUE_PREFIX)` to the JSON report with a TTL and
 * refreshes it periodically; the API reads it. A missing or expired key means no worker has reported
 * (not running, or Redis unreachable), which the API reports as "worker not reporting" (agent runtime unknown), never as a missing key.
 */
export const workerCapabilityReportSchema = z.object({
  /** The worker has an Anthropic API key for the AI agent runtime. */
  agentRuntimeConfigured: z.boolean(),
  /** The worker has the Meta app id and secret it needs to verify numbers (debug_token). Absent in older reports. */
  numberVerificationConfigured: z.boolean().optional(),
  /** When the worker wrote this report (ISO 8601). */
  reportedAt: z.iso.datetime({ offset: true }),
})
export type WorkerCapabilityReport = z.infer<typeof workerCapabilityReportSchema>

/** The report expires unless refreshed, so a stopped worker stops counting after this long. */
export const WORKER_CAPABILITIES_TTL_SECONDS = 300
/** How often a running worker refreshes its report (well inside the TTL). */
export const WORKER_CAPABILITIES_REFRESH_MS = 60_000

/** Redis key of the report, under the deployment's queue prefix (so test runs never see each other). */
export function workerCapabilitiesKey(queuePrefix: string): string {
  return `${queuePrefix}:worker-capabilities`
}

/** The worker's report from its settings: booleans only. */
export function workerCapabilityReport(
  env: { ANTHROPIC_API_KEY?: string | undefined; WHATSAPP_APP_ID?: string | undefined; WHATSAPP_APP_SECRET?: string | undefined },
  now: Date,
): WorkerCapabilityReport {
  return {
    agentRuntimeConfigured: Boolean(env.ANTHROPIC_API_KEY),
    numberVerificationConfigured: Boolean(env.WHATSAPP_APP_ID && env.WHATSAPP_APP_SECRET),
    reportedAt: now.toISOString(),
  }
}

/** The stored report, or null when absent or unreadable (a malformed value never counts as configured). */
export function parseWorkerCapabilityReport(raw: string | null): WorkerCapabilityReport | null {
  if (raw === null) return null
  try {
    const parsed = workerCapabilityReportSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
