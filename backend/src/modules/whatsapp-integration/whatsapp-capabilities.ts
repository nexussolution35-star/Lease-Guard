import type { WorkerCapabilityReport } from '../../infrastructure/capabilities/worker-capabilities'

/** The parts of WhatsApp and the AI agent that need LeaseGuard-side configuration. */
export const WHATSAPP_CAPABILITIES = ['embedded_signup', 'webhook', 'agent_runtime'] as const
export type WhatsAppCapability = (typeof WHATSAPP_CAPABILITIES)[number]

/** The LeaseGuard processes that read settings. */
export const SETTING_PROCESSES = ['api', 'worker'] as const
export type SettingProcess = (typeof SETTING_PROCESSES)[number]

/** A setting a capability still needs, and the process that must have it. Names only, never values. */
export interface MissingSetting {
  capability: WhatsAppCapability
  setting: string
  process: SettingProcess
}

/**
 * Whether LeaseGuard itself is configured for each capability. Public-safe: flags, the public Meta app
 * and configuration ids (the browser needs them for Embedded Signup), and the names of missing
 * settings. Being configured here does not mean Meta has approved the app (App Review, Advanced Access,
 * Business Verification): LeaseGuard cannot see that, and the web app says so.
 */
export interface WhatsAppCapabilities {
  /** WHATSAPP_APP_ID, WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID and WHATSAPP_APP_SECRET (code exchange) are set on the API. */
  embeddedSignupConfigured: boolean
  /** WHATSAPP_APP_SECRET (signature check) and WHATSAPP_WEBHOOK_VERIFY_TOKEN (handshake) are set on the API. */
  webhookConfigured: boolean
  /** The worker reported an Anthropic API key. False also while no worker is reporting (unknown). */
  agentRuntimeConfigured: boolean
  /**
   * A worker reported within the last few minutes. When false, the agent runtime's configuration is
   * unknown (the worker is stopped, cannot reach Redis, or its report expired), so ANTHROPIC_API_KEY is
   * not listed as missing: the page says the worker is not reporting instead.
   */
  workerReporting: boolean
  appId?: string
  embeddedSignupConfigId?: string
  /** When the worker last reported; absent when no worker has reported recently. */
  workerReportedAt?: string
  missing: MissingSetting[]
}

/** The API's WhatsApp settings (backend/src/config/env.ts); unset or blank values are absent. */
export interface WhatsAppApiSettings {
  WHATSAPP_APP_ID?: string | undefined
  WHATSAPP_APP_SECRET?: string | undefined
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?: string | undefined
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string | undefined
}

const REQUIRED: readonly { capability: WhatsAppCapability; setting: keyof WhatsAppApiSettings }[] = [
  { capability: 'embedded_signup', setting: 'WHATSAPP_APP_ID' },
  { capability: 'embedded_signup', setting: 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID' },
  { capability: 'embedded_signup', setting: 'WHATSAPP_APP_SECRET' },
  { capability: 'webhook', setting: 'WHATSAPP_APP_SECRET' },
  { capability: 'webhook', setting: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' },
]

export function whatsAppCapabilities(settings: WhatsAppApiSettings, worker: WorkerCapabilityReport | null): WhatsAppCapabilities {
  const missing: MissingSetting[] = REQUIRED.filter(({ setting }) => !settings[setting]).map(({ capability, setting }) => ({
    capability,
    setting,
    process: 'api',
  }))
  const agentRuntimeConfigured = worker?.agentRuntimeConfigured === true
  // Only a worker's own report can say the key is missing; without one the state is unknown.
  if (worker && !agentRuntimeConfigured) missing.push({ capability: 'agent_runtime', setting: 'ANTHROPIC_API_KEY', process: 'worker' })
  const configured = (capability: WhatsAppCapability) => !missing.some((m) => m.capability === capability)
  return {
    embeddedSignupConfigured: configured('embedded_signup'),
    webhookConfigured: configured('webhook'),
    agentRuntimeConfigured,
    workerReporting: worker !== null,
    ...(settings.WHATSAPP_APP_ID ? { appId: settings.WHATSAPP_APP_ID } : {}),
    ...(settings.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ? { embeddedSignupConfigId: settings.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID } : {}),
    ...(worker ? { workerReportedAt: worker.reportedAt } : {}),
    missing,
  }
}
