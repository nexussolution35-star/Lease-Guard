import { describe, expect, it } from 'vitest'

import { parseWorkerCapabilityReport, workerCapabilitiesKey, workerCapabilityReport } from './worker-capabilities'

describe('worker capability report', () => {
  const now = new Date('2026-11-10T08:00:00.000Z')

  it('reports whether the worker has an Anthropic key, never the key itself', () => {
    const report = workerCapabilityReport({ ANTHROPIC_API_KEY: 'sk-ant-secret' }, now)
    expect(report).toEqual({ agentRuntimeConfigured: true, numberVerificationConfigured: false, reportedAt: '2026-11-10T08:00:00.000Z' })
    expect(JSON.stringify(report)).not.toContain('sk-ant-secret')
    expect(workerCapabilityReport({}, now).agentRuntimeConfigured).toBe(false)
  })

  it('reports whether the worker can verify numbers (Meta app id and secret), never the secret', () => {
    const report = workerCapabilityReport({ WHATSAPP_APP_ID: '424242', WHATSAPP_APP_SECRET: 'app-secret' }, now)
    expect(report.numberVerificationConfigured).toBe(true)
    expect(JSON.stringify(report)).not.toContain('app-secret')
    expect(workerCapabilityReport({ WHATSAPP_APP_ID: '424242' }, now).numberVerificationConfigured).toBe(false)
    // A report from an older worker without the flag still parses.
    expect(parseWorkerCapabilityReport(JSON.stringify({ agentRuntimeConfigured: true, reportedAt: now.toISOString() }))).not.toBeNull()
  })

  it('round-trips through its stored form; anything else counts as no report', () => {
    const report = workerCapabilityReport({ ANTHROPIC_API_KEY: 'x' }, now)
    expect(parseWorkerCapabilityReport(JSON.stringify(report))).toEqual(report)
    expect(parseWorkerCapabilityReport(null)).toBeNull()
    expect(parseWorkerCapabilityReport('not json')).toBeNull()
    expect(parseWorkerCapabilityReport(JSON.stringify({ agentRuntimeConfigured: 'yes', reportedAt: 'today' }))).toBeNull()
  })

  it("keys the report by the deployment's queue prefix", () => {
    expect(workerCapabilitiesKey('leaseguard')).toBe('leaseguard:worker-capabilities')
  })
})
