import { describe, expect, it } from 'vitest'

import type { ProviderStatusOutcome, ProviderStatusUpdate } from '../../messaging/communication-lifecycle'

import type { AccountEvents } from './account-events'
import {
  inboundMessageText,
  type InboundMessage,
  type InboundMessageStore,
  type MessageRecordOutcome,
  type ProviderStatusStore,
  type ReceivingNumber,
  routeWebhookPayload,
} from './inbound-routing'

const ATLAS = { companyId: 'company-atlas', numberId: 'number-atlas' }
const BAOBAB = { companyId: 'company-baobab', numberId: 'number-baobab' }
const NUMBERS: Record<string, ReceivingNumber> = { '1110001': ATLAS, '2220002': BAOBAB }

/** A fake store with the database's dedupe rule: one message id per company. */
function harness() {
  const recorded: { owner: ReceivingNumber; message: InboundMessage }[] = []
  const lookups: string[] = []
  const store: InboundMessageStore = {
    async record(owner, message): Promise<MessageRecordOutcome> {
      if (recorded.some((r) => r.owner.companyId === owner.companyId && r.message.providerMessageId === message.providerMessageId)) return 'duplicate'
      recorded.push({ owner, message })
      return 'recorded'
    },
  }
  const numbers = {
    async forReceivingNumber(phoneNumberId: string) {
      lookups.push(phoneNumberId)
      return NUMBERS[phoneNumberId] ?? null
    },
  }
  // The lifecycle's rule for one message: the status only moves forward; a repeat changes nothing.
  const RANK = { sent: 1, delivered: 2, read: 3, failed: 0 } as const
  const delivery = new Map<string, { status: ProviderStatusUpdate['status']; applied: ProviderStatusUpdate[] }>()
  const statuses: ProviderStatusStore = {
    async record(update): Promise<ProviderStatusOutcome> {
      const key = `${update.companyId}/${update.providerMessageId}`
      const message = delivery.get(key)
      if (!message) return 'not_found'
      if (message.applied.some((a) => a.status === update.status)) return 'unchanged'
      message.applied.push(update)
      if (update.status === 'failed') return 'unchanged'
      if (RANK[update.status] > RANK[message.status]) {
        message.status = update.status
        return 'advanced'
      }
      return 'recorded'
    },
  }
  const accountChanges: { field: string; businessAccountId: string | null }[] = []
  const accounts: AccountEvents = {
    async route(field, change) {
      accountChanges.push({ field, businessAccountId: change.businessAccountId })
      return field === 'account_update' ? [{ field, outcome: 'not_handled' }] : null
    },
  }
  const sent = (companyId: string, providerMessageId: string) => delivery.set(`${companyId}/${providerMessageId}`, { status: 'sent', applied: [] })
  return {
    recorded,
    lookups,
    delivery,
    sent,
    accountChanges,
    route: (payload: unknown) => routeWebhookPayload(payload, { numbers, store, statuses, accounts }),
  }
}

function payload(changes: unknown[]) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes }] }
}

function messages(phoneNumberId: string, msgs: unknown[], contacts: unknown[] = [], statuses: unknown[] = []) {
  return {
    field: 'messages',
    value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '27110000000', phone_number_id: phoneNumberId }, contacts, messages: msgs, statuses },
  }
}

const textMessage = (id: string, from: string | undefined, body: string, extra: Record<string, unknown> = {}) => ({
  id,
  ...(from ? { from } : {}),
  timestamp: '1794297600',
  type: 'text',
  text: { body },
  ...extra,
})

describe('routeWebhookPayload', () => {
  it("records a message for the company that owns the receiving number, with the sender's number and name", async () => {
    const { route, recorded } = harness()
    const outcomes = await route(payload([messages('1110001', [textMessage('wamid.A1', '27829990001', 'Is parking available?')], [{ wa_id: '27829990001', profile: { name: 'Ayanda' } }])]))
    expect(outcomes).toEqual([{ field: 'messages', phoneNumberId: '1110001', companyId: ATLAS.companyId, messageId: 'wamid.A1', outcome: 'recorded' }])
    expect(recorded).toEqual([
      {
        owner: ATLAS,
        message: {
          providerMessageId: 'wamid.A1',
          userId: null,
          waId: '27829990001',
          profileName: 'Ayanda',
          body: 'Is parking available?',
          sentAt: new Date(1794297600 * 1000),
        },
      },
    ])
  })

  it('routes by receiving number only: the same sender writing to two companies lands in each separately', async () => {
    const { route, recorded } = harness()
    await route(
      payload([
        messages('1110001', [textMessage('wamid.A2', '27829990001', 'Hello Atlas')]),
        messages('2220002', [textMessage('wamid.B2', '27829990001', 'Hello Baobab')]),
      ]),
    )
    expect(recorded.map((r) => [r.owner.companyId, r.message.body])).toEqual([
      [ATLAS.companyId, 'Hello Atlas'],
      [BAOBAB.companyId, 'Hello Baobab'],
    ])
  })

  it('records the same message once when Meta delivers it again', async () => {
    const { route, recorded } = harness()
    const body = payload([messages('1110001', [textMessage('wamid.A3', '27829990001', 'Hi')])])
    await route(body)
    const again = await route(body)
    expect(again).toEqual([expect.objectContaining({ messageId: 'wamid.A3', outcome: 'duplicate' })])
    expect(recorded).toHaveLength(1)
  })

  it('drops a message to a number no company has connected, and records why', async () => {
    const { route, recorded } = harness()
    const outcomes = await route(payload([messages('9990009', [textMessage('wamid.X', '27829990001', 'Hi')], [], [{ id: 'wamid.S' }])]))
    expect(outcomes).toEqual([{ field: 'messages', phoneNumberId: '9990009', outcome: 'unknown_number', messages: 1, statuses: 1 }])
    expect(recorded).toEqual([])
  })

  it('identifies a sender by business-scoped user id when Meta omits the phone number', async () => {
    const { route, recorded } = harness()
    await route(
      payload([
        messages('1110001', [textMessage('wamid.A4', undefined, 'Hi', { from_user_id: 'ZA.1349' })], [{ user_id: 'ZA.1349', profile: { name: 'Lebo' } }]),
      ]),
    )
    expect(recorded[0]?.message).toMatchObject({ userId: 'ZA.1349', waId: null, profileName: 'Lebo' })
  })

  it('takes the user id from the contacts list when the message carries only the number', async () => {
    const { route, recorded } = harness()
    await route(payload([messages('1110001', [textMessage('wamid.A5', '27829990002', 'Hi')], [{ wa_id: '27829990002', user_id: 'ZA.77' }])]))
    expect(recorded[0]?.message).toMatchObject({ userId: 'ZA.77', waId: '27829990002' })
  })

  it('refuses a message without any sender identity or id, and keeps routing the rest', async () => {
    const { route, recorded } = harness()
    const outcomes = await route(
      payload([messages('1110001', [{ id: 'wamid.none', type: 'text', text: { body: 'x' } }, { type: 'text' }, textMessage('wamid.ok', '27829990001', 'fine')])]),
    )
    expect(outcomes.map((o) => o.outcome)).toEqual(['invalid', 'invalid', 'recorded'])
    expect(recorded.map((r) => r.message.providerMessageId)).toEqual(['wamid.ok'])
  })

  it('ignores a malformed sender number instead of storing it', async () => {
    const { route, recorded } = harness()
    await route(payload([messages('1110001', [textMessage('wamid.A6', 'not-a-number', 'Hi', { from_user_id: 'ZA.9' })])]))
    expect(recorded[0]?.message).toMatchObject({ userId: 'ZA.9', waId: null })
  })

  it('applies delivery statuses to the outbound message of the company that owns the receiving number', async () => {
    const { route, sent, delivery } = harness()
    sent(ATLAS.companyId, 'wamid.OUT1')
    const outcomes = await route(payload([messages('1110001', [], [], [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1794297600', recipient_id: '27829990001' }])]))
    expect(outcomes).toEqual([
      {
        field: 'messages',
        phoneNumberId: '1110001',
        companyId: ATLAS.companyId,
        statusId: 'wamid.OUT1',
        status: 'delivered',
        occurredAt: new Date(1794297600 * 1000).toISOString(),
        outcome: 'advanced',
      },
    ])
    expect(delivery.get(`${ATLAS.companyId}/wamid.OUT1`)?.status).toBe('delivered')
  })

  it('never moves a message backwards when statuses arrive out of order, and applies a repeat once', async () => {
    const { route, sent, delivery } = harness()
    sent(ATLAS.companyId, 'wamid.OUT2')
    const read = { id: 'wamid.OUT2', status: 'read', timestamp: '1794297700' }
    const deliveredLate = { id: 'wamid.OUT2', status: 'delivered', timestamp: '1794297650' }
    const outcomes = await route(payload([messages('1110001', [], [], [read, deliveredLate, read])]))
    expect(outcomes.map((o) => o.outcome)).toEqual(['advanced', 'recorded', 'unchanged'])
    expect(delivery.get(`${ATLAS.companyId}/wamid.OUT2`)?.status).toBe('read')
    expect(delivery.get(`${ATLAS.companyId}/wamid.OUT2`)?.applied.map((a) => a.status)).toEqual(['read', 'delivered'])
  })

  it("never applies a status to another company's message with the same id", async () => {
    const { route, sent, delivery } = harness()
    sent(BAOBAB.companyId, 'wamid.OUT3')
    const outcomes = await route(payload([messages('1110001', [], [], [{ id: 'wamid.OUT3', status: 'read' }])]))
    expect(outcomes).toEqual([expect.objectContaining({ companyId: ATLAS.companyId, statusId: 'wamid.OUT3', outcome: 'not_found' })])
    expect(delivery.get(`${BAOBAB.companyId}/wamid.OUT3`)?.status).toBe('sent')
  })

  it("records Meta's error as the failure reason, without the message or the recipient", async () => {
    const { route, sent, delivery } = harness()
    sent(ATLAS.companyId, 'wamid.OUT4')
    await route(
      payload([
        messages('1110001', [], [], [
          {
            id: 'wamid.OUT4',
            status: 'failed',
            recipient_id: '27829990001',
            errors: [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.', error_data: { details: 'Per-user limit' } }],
          },
        ]),
      ]),
    )
    expect(delivery.get(`${ATLAS.companyId}/wamid.OUT4`)?.applied[0]).toMatchObject({
      status: 'failed',
      failureReason: 'WhatsApp error 131049: This message was not delivered to maintain healthy ecosystem engagement. (Per-user limit)',
    })
  })

  it('reports statuses it does not track and statuses without an id, and keeps the rest', async () => {
    const { route, sent } = harness()
    sent(ATLAS.companyId, 'wamid.OUT5')
    const outcomes = await route(payload([messages('1110001', [], [], [{ id: 'wamid.OUT5', status: 'deleted' }, { status: 'read' }, { id: 'wamid.OUT5', status: 'read' }])]))
    expect(outcomes.map((o) => o.outcome)).toEqual(['not_handled', 'invalid', 'advanced'])
  })

  it('hands account-level changes to the account events with the WhatsApp Business Account of the entry', async () => {
    const { route, accountChanges } = harness()
    const outcomes = await route(payload([{ field: 'account_update', value: { event: 'PARTNER_APP_UNINSTALLED' } }, { field: 'calls', value: {} }]))
    expect(outcomes).toEqual([
      { field: 'account_update', outcome: 'not_handled' },
      { field: 'calls', outcome: 'not_handled' },
    ])
    expect(accountChanges).toEqual([
      { field: 'account_update', businessAccountId: 'waba-1' },
      { field: 'calls', businessAccountId: 'waba-1' },
    ])
  })

  it('looks each receiving number up once per payload', async () => {
    const { route, lookups } = harness()
    await route(payload([messages('1110001', [textMessage('wamid.1', '27829990001', 'a')]), messages('1110001', [textMessage('wamid.2', '27829990001', 'b')])]))
    expect(lookups).toEqual(['1110001'])
  })

  it('reports a payload that is not a WhatsApp Business Account payload', async () => {
    const { route } = harness()
    await expect(route({ entry: 'nope' })).resolves.toEqual([{ field: 'payload', outcome: 'invalid', reason: 'not a WhatsApp Business Account payload' }])
    await expect(route({ object: 'page', entry: [] })).resolves.toEqual([{ field: 'payload', outcome: 'not_handled' }])
  })
})

describe('inboundMessageText', () => {
  it('describes each kind of message for the inbox without downloading media', () => {
    expect(inboundMessageText({ type: 'text', text: { body: 'Hello' } })).toBe('Hello')
    expect(inboundMessageText({ type: 'image', image: { caption: 'Leak in unit 4' } })).toBe('[Image] Leak in unit 4')
    expect(inboundMessageText({ type: 'document', document: { filename: 'invoice.pdf' } })).toBe('[Document] invoice.pdf')
    expect(inboundMessageText({ type: 'audio', audio: { voice: true } })).toBe('[Voice note]')
    expect(inboundMessageText({ type: 'location', location: { name: 'Sandton City', address: 'Rivonia Rd' } })).toBe('[Location] Sandton City, Rivonia Rd')
    expect(inboundMessageText({ type: 'interactive', interactive: { button_reply: { title: 'Yes' } } })).toBe('Yes')
    expect(inboundMessageText({ type: 'reaction', reaction: { emoji: '👍' } })).toBe('[Reaction] 👍')
    expect(inboundMessageText({ type: 'unsupported' })).toBe('[Unsupported message]')
    expect(inboundMessageText({ type: 'text', text: {} })).toBe('(Empty message)')
  })
})
