import { describe, expect, it } from 'vitest'

import { FakeWhatsAppChannels } from '../../infrastructure/whatsapp/fake-whatsapp-channels.test-helpers'
import { ChannelLookupError } from '../../infrastructure/whatsapp/whatsapp-channels'
import { WhatsAppApiError } from '../../infrastructure/whatsapp/whatsapp.client'
import { WorkerDatabaseError } from '../shared/db'
import { sendTestMessage, type TestMessageStore, type TestMessageToSend } from './test-message'

const COMPANY = 'c0000000-0000-4000-8000-000000000001'
const TEST = 't0000000-0000-4000-8000-000000000001'
const JOB = { companyId: COMPANY, testMessageId: TEST }

const READY: TestMessageToSend = {
  status: 'queued',
  toNumber: '+27829990001',
  templateName: 'hello_world',
  templateLanguage: 'en_US',
  phoneNumberId: '564738291045',
  numberConnected: true,
  templateApproved: true,
  recipientIsTenant: false,
}

class MemoryStore implements TestMessageStore {
  events: string[] = []
  claimable = true
  /** Operations that throw (a transient database failure). */
  failing = new Set<'load' | 'claim' | 'release' | 'recordSent'>()
  constructor(private row: TestMessageToSend | null = { ...READY }) {}

  async load(companyId: string, id: string) {
    this.events.push(`load ${companyId} ${id}`)
    if (this.failing.has('load')) throw new Error('database unreachable (load)')
    return this.row
  }
  async claim() {
    this.events.push('claim')
    if (this.failing.has('claim')) throw new Error('database unreachable (claim)')
    return this.claimable
  }
  async release() {
    this.events.push('release')
    if (this.failing.has('release')) throw new Error('database unreachable (release)')
  }
  async recordSent(_c: string, _id: string, providerMessageId: string) {
    if (this.failing.has('recordSent')) throw new Error('database unreachable (recordSent)')
    this.events.push(`sent ${providerMessageId}`)
  }
  async recordFailed(_c: string, _id: string, reason: string, mayHaveBeenSent: boolean) {
    this.events.push(`failed ${mayHaveBeenSent ? 'maybe-sent ' : ''}${reason}`)
  }
}

const FIRST = { finalAttempt: false }

describe('sendTestMessage', () => {
  it('sends the approved template from the chosen number and records Meta’s message id (sent, not yet delivered)', async () => {
    const store = new MemoryStore()
    const channels = new FakeWhatsAppChannels({ send: async () => ({ messageId: 'wamid.TEST' }) })

    await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toEqual({ outcome: 'sent', providerMessageId: 'wamid.TEST' })
    expect(channels.lookups).toEqual([{ companyId: COMPANY, options: { phoneNumberId: '564738291045' } }])
    expect(channels.sends).toEqual([
      {
        companyId: COMPANY,
        to: '+27829990001',
        message: { type: 'template', template: { name: 'hello_world', language: { code: 'en_US' }, components: [] } },
      },
    ])
    expect(store.events).toEqual([`load ${COMPANY} ${TEST}`, 'claim', 'sent wamid.TEST'])
  })

  it('never sends a test message twice: one already claimed or sent is skipped', async () => {
    for (const status of ['sending', 'sent', 'delivered', 'failed'] as const) {
      const store = new MemoryStore({ ...READY, status })
      const channels = new FakeWhatsAppChannels()
      await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toEqual({ outcome: 'skipped' })
      expect(channels.sends).toEqual([])
    }
    const lost = new MemoryStore()
    lost.claimable = false
    const channels = new FakeWhatsAppChannels()
    await expect(sendTestMessage({ store: lost, channels }, JOB, FIRST)).resolves.toEqual({ outcome: 'skipped' })
    expect(channels.sends).toEqual([])
  })

  it('skips a test message that does not exist in the company', async () => {
    await expect(sendTestMessage({ store: new MemoryStore(null), channels: new FakeWhatsAppChannels() }, JOB, FIRST)).resolves.toEqual({ outcome: 'skipped' })
  })

  it('fails without sending when the number was disconnected, the template lost Meta’s approval or the recipient became a tenant', async () => {
    const cases: [Partial<TestMessageToSend>, RegExp][] = [
      [{ numberConnected: false }, /no longer connected/],
      [{ templateApproved: false }, /no longer approved/],
      [{ recipientIsTenant: true }, /tenant/],
    ]
    for (const [change, reason] of cases) {
      const store = new MemoryStore({ ...READY, ...change })
      const channels = new FakeWhatsAppChannels()
      await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toMatchObject({ outcome: 'failed' })
      expect(channels.sends).toEqual([])
      expect(store.events.at(-1)).toMatch(reason)
      expect(store.events).not.toContain('claim')
    }
  })

  it('fails with the channel’s reason when the number has no usable token', async () => {
    const store = new MemoryStore()
    const channels = new FakeWhatsAppChannels({ unavailable: { reason: 'credentials_unavailable', message: 'The access token is not available' } })
    await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toMatchObject({ outcome: 'failed' })
    expect(store.events.at(-1)).toBe('failed The access token is not available')
  })

  it('hands the claim back and lets the job retry when Meta throttles, and fails on the last attempt', async () => {
    const throttled = () => new FakeWhatsAppChannels({ send: async () => Promise.reject(new WhatsAppApiError('Throttled (130429)', { retryable: true, graphCode: 130429 })) })
    const store = new MemoryStore()
    await expect(sendTestMessage({ store, channels: throttled() }, JOB, FIRST)).rejects.toThrow(/Throttled/)
    expect(store.events).toEqual([`load ${COMPANY} ${TEST}`, 'claim', 'release'])

    const last = new MemoryStore()
    await expect(sendTestMessage({ store: last, channels: throttled() }, JOB, { finalAttempt: true })).resolves.toMatchObject({ outcome: 'failed' })
    expect(last.events.at(-1)).toBe('failed Throttled (130429)')
  })

  it('records Meta’s refusal (e.g. a template that needs parameters) without retrying', async () => {
    const store = new MemoryStore()
    const channels = new FakeWhatsAppChannels({
      send: async () => Promise.reject(new WhatsAppApiError('(#132000) Number of parameters does not match', { retryable: false, status: 400, graphCode: 132000 })),
    })
    await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toMatchObject({ outcome: 'failed' })
    expect(store.events.at(-1)).toBe('failed (#132000) Number of parameters does not match')
  })

  it('never sends again when Meta may have accepted it (unknown outcome)', async () => {
    const store = new MemoryStore()
    const channels = new FakeWhatsAppChannels({ send: async () => Promise.reject(new WhatsAppApiError('timeout', { retryable: true, outcomeUnknown: true })) })
    await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toMatchObject({ outcome: 'failed' })
    expect(store.events.at(-1)).toMatch(/^failed maybe-sent .*may have been sent/)
    expect(store.events).not.toContain('release')
  })

  it('retries a transient failure before the send, and records it as failed on the final attempt (never left queued)', async () => {
    const lookupError = new ChannelLookupError('Look up the WhatsApp account', 'PGRST000', 'connection refused')
    const retried = new MemoryStore()
    await expect(sendTestMessage({ store: retried, channels: new FakeWhatsAppChannels({ lookupError }) }, JOB, FIRST)).rejects.toBe(lookupError)
    expect(retried.events.some((event) => event.startsWith('failed'))).toBe(false)

    const last = new MemoryStore()
    const channels = new FakeWhatsAppChannels({ lookupError })
    await expect(sendTestMessage({ store: last, channels }, JOB, { finalAttempt: true })).resolves.toMatchObject({ outcome: 'failed' })
    expect(channels.sends).toEqual([])
    expect(last.events.at(-1)).toMatch(/^failed The test message could not be sent \(Look up the WhatsApp account failed .*Nothing was sent/)

    for (const operation of ['load', 'claim'] as const) {
      const store = new MemoryStore()
      store.failing.add(operation)
      const sends = new FakeWhatsAppChannels()
      await expect(sendTestMessage({ store, channels: sends }, JOB, FIRST)).rejects.toThrow(operation)
      await expect(sendTestMessage({ store, channels: sends }, JOB, { finalAttempt: true })).resolves.toMatchObject({ outcome: 'failed' })
      expect(store.events.at(-1)).toMatch(new RegExp(`^failed (?!maybe-sent).*database unreachable \\(${operation}\\)`))
      expect(sends.sends).toEqual([])
    }
  })

  it('rethrows the original error when even the failure cannot be recorded on the final attempt', async () => {
    const store = new MemoryStore()
    store.failing.add('load')
    store.recordFailed = async () => Promise.reject(new WorkerDatabaseError('Record the WhatsApp test message as failed', { code: 'PGRST000', message: 'down' }))
    await expect(sendTestMessage({ store, channels: new FakeWhatsAppChannels() }, JOB, { finalAttempt: true })).rejects.toThrow('database unreachable (load)')
  })

  it('records Meta’s throttling as failed when the claim cannot be handed back (the retry would skip it)', async () => {
    const store = new MemoryStore()
    store.failing.add('release')
    const channels = new FakeWhatsAppChannels({ send: async () => Promise.reject(new WhatsAppApiError('Throttled (130429)', { retryable: true, graphCode: 130429 })) })
    await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toMatchObject({ outcome: 'failed' })
    expect(store.events.slice(-2)).toEqual(['release', 'failed Throttled (130429)'])
  })

  it('records a send that could not be recorded as possibly sent, instead of leaving it sending', async () => {
    const store = new MemoryStore()
    store.failing.add('recordSent')
    const channels = new FakeWhatsAppChannels({ send: async () => ({ messageId: 'wamid.TEST' }) })
    await expect(sendTestMessage({ store, channels }, JOB, FIRST)).resolves.toMatchObject({ outcome: 'failed' })
    expect(channels.sends).toHaveLength(1)
    expect(store.events.at(-1)).toMatch(/^failed maybe-sent WhatsApp accepted the test message, but it could not be recorded/)
  })
})
