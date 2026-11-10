import { describe, expect, it } from 'vitest'

import { whatsAppCapabilities } from './whatsapp-capabilities'

const ALL = {
  WHATSAPP_APP_ID: '1234567890123456',
  WHATSAPP_APP_SECRET: 'app-secret-value',
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '987654321098765',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token-value',
}
const WORKER = { agentRuntimeConfigured: true, reportedAt: '2026-11-10T08:00:00.000Z' }

describe('whatsAppCapabilities', () => {
  it('reports every capability configured, with the public app and configuration ids for the browser', () => {
    expect(whatsAppCapabilities(ALL, WORKER)).toEqual({
      embeddedSignupConfigured: true,
      webhookConfigured: true,
      agentRuntimeConfigured: true,
      workerReporting: true,
      appId: '1234567890123456',
      embeddedSignupConfigId: '987654321098765',
      workerReportedAt: '2026-11-10T08:00:00.000Z',
      missing: [],
    })
  })

  it('never exposes the app secret or the webhook verify token', () => {
    const json = JSON.stringify(whatsAppCapabilities(ALL, WORKER))
    expect(json).not.toContain('app-secret-value')
    expect(json).not.toContain('verify-token-value')
  })

  it('says exactly which settings are missing, and which process reads each', () => {
    expect(whatsAppCapabilities({}, { agentRuntimeConfigured: false, reportedAt: WORKER.reportedAt })).toEqual({
      embeddedSignupConfigured: false,
      webhookConfigured: false,
      agentRuntimeConfigured: false,
      workerReporting: true,
      workerReportedAt: WORKER.reportedAt,
      missing: [
        { capability: 'embedded_signup', setting: 'WHATSAPP_APP_ID', process: 'api' },
        { capability: 'embedded_signup', setting: 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', process: 'api' },
        { capability: 'embedded_signup', setting: 'WHATSAPP_APP_SECRET', process: 'api' },
        { capability: 'webhook', setting: 'WHATSAPP_APP_SECRET', process: 'api' },
        { capability: 'webhook', setting: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', process: 'api' },
        { capability: 'agent_runtime', setting: 'ANTHROPIC_API_KEY', process: 'worker' },
      ],
    })
  })

  it('needs the app secret for Embedded Signup (the code exchange) as well as the public ids', () => {
    const { WHATSAPP_APP_SECRET: _secret, ...withoutSecret } = ALL
    const capabilities = whatsAppCapabilities(withoutSecret, WORKER)
    expect(capabilities.embeddedSignupConfigured).toBe(false)
    expect(capabilities.webhookConfigured).toBe(false)
    expect(capabilities.missing.map((m) => `${m.capability}:${m.setting}`)).toEqual(['embedded_signup:WHATSAPP_APP_SECRET', 'webhook:WHATSAPP_APP_SECRET'])
  })

  it("takes the agent runtime from the worker's own report: the API never holds the Anthropic key", () => {
    expect(whatsAppCapabilities(ALL, { ...WORKER, agentRuntimeConfigured: false })).toMatchObject({
      agentRuntimeConfigured: false,
      workerReportedAt: WORKER.reportedAt,
      missing: [{ capability: 'agent_runtime', setting: 'ANTHROPIC_API_KEY', process: 'worker' }],
    })
  })

  it('does not blame ANTHROPIC_API_KEY when no worker has reported: the runtime state is unknown', () => {
    const silent = whatsAppCapabilities(ALL, null)
    expect(silent).toMatchObject({ agentRuntimeConfigured: false, workerReporting: false, missing: [] })
    expect(silent).not.toHaveProperty('workerReportedAt')
    expect(whatsAppCapabilities({}, null).missing.map((m) => m.setting)).not.toContain('ANTHROPIC_API_KEY')
  })
})
