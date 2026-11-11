import type { EntityId, WhatsAppConnectionStatus } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { FakeWhatsAppChannels } from '../../infrastructure/whatsapp/fake-whatsapp-channels.test-helpers'
import {
  type MetaMessageTemplate,
  type MetaPhoneNumber,
  type NumberManagement,
  type TokenInspection,
  WhatsAppApiError,
} from '../../infrastructure/whatsapp/whatsapp-channels'
import {
  type NumberToVerify,
  type StepRecord,
  TransientVerificationError,
  type VerificationStore,
  verifyNumber,
} from './number-verification'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'
const NOW = new Date('2026-11-10T10:00:00Z')
const ACCOUNT = '771001'
const PHONE = '660001'

const VALID_TOKEN: TokenInspection = {
  isValid: true,
  granularScopes: [
    { scope: 'whatsapp_business_management', targetIds: [ACCOUNT] },
    { scope: 'whatsapp_business_messaging', targetIds: [ACCOUNT] },
  ],
}
const UNREGISTERED: MetaPhoneNumber = { id: PHONE, displayPhoneNumber: '+27 11 555 0100', verifiedName: 'Atlas', status: 'PENDING' }
const TEMPLATES: MetaMessageTemplate[] = [
  { id: '9001', name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED' },
  { id: '9002', name: 'promo', language: 'en', category: 'MARKETING', status: 'PENDING' },
]

interface MetaFake {
  inspection?: TokenInspection | null | Error
  numbers?: MetaPhoneNumber[] | Error
  subscribe?: Error
  register?: Error
  templates?: MetaMessageTemplate[] | Error
}

const settle = <T,>(value: T | Error): Promise<T> => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value))

function harness(options: { number?: Partial<NumberToVerify> | null; meta?: MetaFake; pin?: string | null; unavailable?: boolean } = {}) {
  const calls: string[] = []
  const pins: string[] = []
  const latest = new Map<string, StepRecord>()
  const written: StepRecord[][] = []
  const store: VerificationStore & { metaViews: MetaPhoneNumber[]; blocks: Date[]; synced: MetaMessageTemplate[][] } = {
    metaViews: [],
    blocks: [],
    synced: [],
    async load() {
      return options.number === null
        ? null
        : { connectionStatus: 'pending_verification', registrationBlockedUntil: null, onBusinessApp: false, importedByOperator: false, ...options.number }
    },
    async recordSteps(_c, _n, steps) {
      written.push([...steps])
      for (const step of steps) latest.set(step.step, step)
    },
    async recordMetaView(_c, _n, number) {
      this.metaViews.push(number)
    },
    async blockRegistration(_c, _n, until) {
      this.blocks.push(until)
    },
    async syncTemplates(_c, accountId, templates) {
      expect(accountId).toBe(ACCOUNT)
      this.synced.push([...templates])
      return templates.length
    },
    async finish(): Promise<WhatsAppConnectionStatus> {
      const all = [...latest.values()]
      if (all.length === 5 && all.every((s) => s.status === 'passed' || s.status === 'not_required')) return 'connected'
      return all.some((s) => s.status === 'failed') ? 'error' : 'pending_verification'
    },
  }
  const meta = options.meta ?? {}
  const management: NumberManagement = {
    available: true,
    businessAccountId: ACCOUNT,
    phoneNumberId: PHONE,
    inspectToken: () => (calls.push('debug_token'), settle(meta.inspection === undefined ? VALID_TOKEN : meta.inspection)),
    accountPhoneNumbers: () => (calls.push('phone_numbers'), settle(meta.numbers ?? [UNREGISTERED])),
    subscribeApp: () => (calls.push('subscribed_apps'), meta.subscribe ? Promise.reject(meta.subscribe) : Promise.resolve()),
    register: (pin) => (calls.push('register'), pins.push(pin), meta.register ? Promise.reject(meta.register) : Promise.resolve()),
    templates: () => (calls.push('message_templates'), settle(meta.templates ?? TEMPLATES)),
  }
  const channels = new FakeWhatsAppChannels({
    manageNumber: async (companyId: EntityId, numberId: EntityId) => {
      expect([companyId, numberId]).toEqual([COMPANY, NUMBER])
      return options.unavailable ? { available: false, reason: 'credentials_unavailable', message: 'The WhatsApp access token is not in the vault' } : management
    },
  })
  let pin = options.pin === undefined ? null : options.pin
  const taken: number[] = []
  const deps = {
    channels,
    store,
    pins: {
      async take() {
        taken.push(1)
        const value = pin
        pin = null
        return value
      },
    },
    now: () => NOW,
  }
  const run = (finalAttempt = false) => verifyNumber({ companyId: COMPANY, numberId: NUMBER }, { finalAttempt }, deps)
  const step = (name: StepRecord['step']) => latest.get(name)
  return { run, calls, pins, store, step, written, taken }
}

const graphError = (graphCode: number, retryable = false) =>
  new WhatsAppApiError(`WhatsApp Graph API returned HTTP 400 (code ${graphCode})`, { retryable, status: 400, graphCode })

describe('verifyNumber', () => {
  it('connects a number only after every step passed, recording each one', async () => {
    const h = harness({ meta: { numbers: [{ ...UNREGISTERED, platformType: 'CLOUD_API' }] } })
    await expect(h.run()).resolves.toMatchObject({ outcome: 'verified', status: 'connected' })
    expect(h.calls).toEqual(['debug_token', 'phone_numbers', 'subscribed_apps', 'message_templates'])
    expect(h.written[0]?.map((s) => [s.step, s.status])).toEqual([
      ['token_scopes', 'pending'],
      ['phone_number', 'pending'],
      ['webhook_subscription', 'pending'],
      ['registration', 'pending'],
      ['message_templates', 'pending'],
    ])
    expect(h.step('registration')).toMatchObject({ status: 'passed', message: expect.stringContaining('registered for the WhatsApp Cloud API') })
    expect(h.step('message_templates')?.message).toBe('2 message template(s) synced from Meta, 1 approved.')
    expect(h.store.metaViews).toEqual([{ ...UNREGISTERED, platformType: 'CLOUD_API' }])
    expect(h.store.synced).toEqual([TEMPLATES])
  })

  it('waits for the admin when the number needs registering, but still syncs templates', async () => {
    const h = harness()
    await expect(h.run()).resolves.toMatchObject({ status: 'pending_verification' })
    expect(h.step('registration')).toMatchObject({ status: 'action_needed', recovery: expect.stringContaining('never stores the PIN') })
    expect(h.step('message_templates')?.status).toBe('passed')
    expect(h.calls).not.toContain('register')
  })

  it("registers with the admin's PIN, used once", async () => {
    const h = harness({ pin: '123456' })
    await expect(h.run()).resolves.toMatchObject({ status: 'connected' })
    expect(h.pins).toEqual(['123456'])
    expect(h.step('registration')?.status).toBe('passed')
    expect(JSON.stringify(h.written)).not.toContain('123456')
  })

  it('does not register a WhatsApp Business app number (coexistence)', async () => {
    const h = harness({ number: { onBusinessApp: true }, pin: '123456' })
    await expect(h.run()).resolves.toMatchObject({ status: 'connected' })
    expect(h.step('registration')?.status).toBe('not_required')
    expect(h.calls).not.toContain('register')
    expect(h.taken).toEqual([])
  })

  it("turns Meta's registration rate limit into a 72-hour lock and a clear message, without retrying", async () => {
    const h = harness({ pin: '123456', meta: { register: graphError(133016) } })
    await expect(h.run()).resolves.toMatchObject({ status: 'error' })
    expect(h.store.blocks).toEqual([new Date('2026-11-13T10:00:00Z')])
    expect(h.step('registration')).toMatchObject({ status: 'failed', metaErrorCode: '133016', message: expect.stringContaining('10 registration attempts per 72 hours') })
    expect(h.calls.filter((c) => c === 'register')).toHaveLength(1)
    expect(h.step('message_templates')).toMatchObject({ status: 'pending', message: 'Not checked: an earlier step did not pass.' })
  })

  it('never calls Meta to register while the lock lasts, and keeps the PIN out of reach', async () => {
    const h = harness({ number: { registrationBlockedUntil: new Date('2026-11-12T10:00:00Z') }, pin: '123456' })
    await expect(h.run()).resolves.toMatchObject({ status: 'error' })
    expect(h.calls).not.toContain('register')
    expect(h.taken).toEqual([])
    expect(h.step('registration')).toMatchObject({ status: 'failed', metaErrorCode: '133016' })
  })

  it('does not retry a registration Meta could not complete: the PIN is spent and the admin is told', async () => {
    const h = harness({ pin: '123456', meta: { register: new WhatsAppApiError('unreachable', { retryable: true, outcomeUnknown: true }) } })
    await expect(h.run()).resolves.toMatchObject({ status: 'error' })
    expect(h.step('registration')).toMatchObject({ status: 'failed', recovery: expect.stringContaining('Verify again') })
  })

  it('reports a refused PIN with Meta’s code', async () => {
    const h = harness({ pin: '654321', meta: { register: graphError(133005) } })
    await h.run()
    expect(h.step('registration')).toMatchObject({ status: 'failed', metaErrorCode: '133005', message: expect.stringContaining('two-step verification PIN') })
  })

  it('fails the token step when the token does not cover the account, and checks nothing further', async () => {
    const h = harness({
      meta: { inspection: { isValid: true, granularScopes: [{ scope: 'whatsapp_business_management', targetIds: ['999'] }, { scope: 'whatsapp_business_messaging' }] } },
    })
    await expect(h.run()).resolves.toMatchObject({ status: 'error' })
    expect(h.step('token_scopes')).toMatchObject({ status: 'failed', message: expect.stringContaining('whatsapp_business_management') })
    expect(h.step('token_scopes')?.message).not.toContain('whatsapp_business_messaging')
    expect(h.calls).toEqual(['debug_token'])
    expect(['phone_number', 'webhook_subscription', 'registration', 'message_templates'].map((s) => h.step(s as StepRecord['step'])?.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ])
  })

  it('explains an invalid token, missing app credentials and an unavailable credential', async () => {
    const invalid = harness({ meta: { inspection: { isValid: false, granularScopes: [] } } })
    await invalid.run()
    expect(invalid.step('token_scopes')).toMatchObject({ status: 'failed', recovery: expect.stringContaining('Connect WhatsApp Business') })

    const noApp = harness({ meta: { inspection: null } })
    await noApp.run()
    expect(noApp.step('token_scopes')?.message).toContain('WHATSAPP_APP_SECRET')

    const unavailable = harness({ unavailable: true })
    await expect(unavailable.run()).resolves.toMatchObject({ status: 'error' })
    expect(unavailable.step('token_scopes')?.message).toBe('The WhatsApp access token is not in the vault')
  })

  it('tells the admin to have Nexus Solution import a number again when the number came from the number import', async () => {
    const invalid = harness({ number: { importedByOperator: true }, meta: { inspection: { isValid: false, granularScopes: [] } } })
    await invalid.run()
    expect(invalid.step('token_scopes')).toMatchObject({ status: 'failed', recovery: expect.stringContaining('Ask Nexus Solution to import') })
    expect(invalid.step('token_scopes')?.recovery).not.toContain('Connect WhatsApp Business')

    const uncovered = harness({ number: { importedByOperator: true }, meta: { inspection: { isValid: true, granularScopes: [] } } })
    await uncovered.run()
    expect(uncovered.step('token_scopes')?.recovery).toContain('Ask Nexus Solution to import')
    expect(uncovered.step('token_scopes')?.recovery).not.toContain('Meta’s window')

    const unavailable = harness({ number: { importedByOperator: true }, unavailable: true })
    await unavailable.run()
    expect(unavailable.step('token_scopes')?.recovery).toContain('Ask Nexus Solution to import')

    const unlisted = harness({ number: { importedByOperator: true }, meta: { numbers: [{ id: '999' }] } })
    await unlisted.run()
    expect(unlisted.step('phone_number')).toMatchObject({ status: 'failed', recovery: expect.stringContaining('phone number id and WhatsApp Business Account id') })
    expect(unlisted.step('phone_number')?.recovery).not.toContain('Connect WhatsApp Business')
  })

  it('fails the number step when Meta does not list it in the account', async () => {
    const h = harness({ meta: { numbers: [{ id: '999' }] } })
    await h.run()
    expect(h.step('phone_number')).toMatchObject({ status: 'failed', message: expect.stringContaining('does not list number id 660001') })
    expect(h.calls).not.toContain('subscribed_apps')
  })

  it('shows which step failed when Meta refuses the subscription', async () => {
    const h = harness({ meta: { subscribe: graphError(200) } })
    await expect(h.run()).resolves.toMatchObject({ status: 'error' })
    expect(h.step('token_scopes')?.status).toBe('passed')
    expect(h.step('phone_number')?.status).toBe('passed')
    expect(h.step('webhook_subscription')).toMatchObject({ status: 'failed', metaErrorCode: '200' })
  })

  it('retries transient Meta failures, and records them as failed on the final attempt', async () => {
    const throttled = new WhatsAppApiError('throttled', { retryable: true, status: 429 })
    await expect(harness({ meta: { templates: throttled } }).run()).rejects.toBeInstanceOf(TransientVerificationError)
    const last = harness({ meta: { templates: throttled } })
    await expect(last.run(true)).resolves.toMatchObject({ status: 'error' })
    expect(last.step('message_templates')).toMatchObject({ status: 'failed', message: 'LeaseGuard could not reach Meta to check this.' })
  })

  it('leaves a missing or disconnected number alone', async () => {
    await expect(harness({ number: null }).run()).resolves.toEqual({ outcome: 'skipped', reason: 'not_found' })
    const disconnected = harness({ number: { connectionStatus: 'disconnected' } })
    await expect(disconnected.run()).resolves.toEqual({ outcome: 'skipped', reason: 'disconnected' })
    expect(disconnected.calls).toEqual([])
  })
})
