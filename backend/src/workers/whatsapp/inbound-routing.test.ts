import { describe, expect, it } from 'vitest'

import {
  inboundMessageText,
  type InboundMessage,
  type InboundMessageStore,
  type MessageRecordOutcome,
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
  return { recorded, lookups, route: (payload: unknown) => routeWebhookPayload(payload, { numbers, store }) }
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

  it('leaves statuses and account events to later tickets, recording that they were not handled', async () => {
    const { route } = harness()
    const outcomes = await route(payload([messages('1110001', [], [], [{ id: 'wamid.S1', status: 'read' }]), { field: 'account_update', value: { event: 'PARTNER_APP_UNINSTALLED' } }]))
    expect(outcomes).toEqual([
      { field: 'messages', phoneNumberId: '1110001', companyId: ATLAS.companyId, outcome: 'statuses_not_handled', statuses: 1 },
      { field: 'account_update', outcome: 'not_handled' },
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
