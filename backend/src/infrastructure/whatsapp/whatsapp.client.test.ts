import { describe, expect, it } from 'vitest'

import { type FetchFn, WhatsAppApiError, WhatsAppClient } from './whatsapp.client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function client(respond: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return respond()
  }
  return { calls, client: new WhatsAppClient({ apiUrl: 'https://graph.facebook.com/', apiVersion: 'v23.0', fetch: fetchFn }) }
}

async function failureOf(promise: Promise<unknown>): Promise<WhatsAppApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(WhatsAppApiError)
    return error as WhatsAppApiError
  }
  throw new Error('expected a WhatsAppApiError')
}

const text = { type: 'text' as const, text: { body: 'Hello', preview_url: false as const } }

describe('WhatsAppClient', () => {
  it('posts the message to /{version}/{phone_number_id}/messages with the bearer token', async () => {
    const { client: wa, calls } = client(async () => jsonResponse(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] }))
    await expect(wa.sendMessage('1234567890', 'token-1', '+27 82 123 4567', text)).resolves.toEqual({ messageId: 'wamid.ABC' })
    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/1234567890/messages')
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '27821234567',
      type: 'text',
      text: { body: 'Hello', preview_url: false },
    })
  })

  it('never retries client errors, and does not leak the token', async () => {
    const error = await failureOf(
      client(async () => jsonResponse(400, { error: { message: 'Invalid parameter', type: 'OAuthException', code: 100 } })).client.sendMessage(
        '1234567890',
        'token-1',
        '+27821234567',
        text,
      ),
    )
    expect(error).toMatchObject({ retryable: false, status: 400, graphCode: 100 })
    expect(error.message).toBe('WhatsApp Graph API returned HTTP 400 (code 100): Invalid parameter')
    expect(error.message).not.toContain('token-1')
    expect(await failureOf(client(async () => jsonResponse(401, { error: { message: 'Expired', code: 190 } })).client.sendMessage('1', 't', '+1', text))).toMatchObject({
      retryable: false,
    })
  })

  it('retries rate limiting, server errors, Graph throttling codes and network failures', async () => {
    for (const status of [429, 500, 503]) {
      expect(await failureOf(client(async () => jsonResponse(status, {})).client.sendMessage('1', 't', '+1', text))).toMatchObject({ retryable: true, status })
    }
    const throttled = await failureOf(
      client(async () => jsonResponse(400, { error: { message: 'Rate limit hit', code: 130429 } })).client.sendMessage('1', 't', '+1', text),
    )
    expect(throttled).toMatchObject({ retryable: true, graphCode: 130429 })
    const network = await failureOf(
      client(async () => {
        throw new TypeError('fetch failed')
      }).client.sendMessage('1', 't', '+1', text),
    )
    expect(network.retryable).toBe(true)
  })

  it('marks failures after which Meta may have accepted the request as outcomeUnknown', async () => {
    const unknown = async (respond: () => Promise<Response>) => (await failureOf(client(respond).client.sendMessage('1', 't', '+1', text))).outcomeUnknown
    // Sent, then no answer: a network failure or the timeout.
    expect(await unknown(async () => Promise.reject(new TypeError('fetch failed')))).toBe(true)
    expect(await unknown(async () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))).toBe(true)
    // A server error, unless it is a throttling code, and a success without a message id.
    expect(await unknown(async () => jsonResponse(500, {}))).toBe(true)
    expect(await unknown(async () => jsonResponse(503, { error: { message: 'Service unavailable', code: 2 } }))).toBe(true)
    expect(await unknown(async () => jsonResponse(503, { error: { message: 'Rate limit hit', code: 130429 } }))).toBe(false)
    expect(await unknown(async () => jsonResponse(200, { messages: [] }))).toBe(true)
    // Refusals: nothing was accepted.
    for (const status of [400, 401, 408, 429]) expect(await unknown(async () => jsonResponse(status, {}))).toBe(false)
    expect(await unknown(async () => jsonResponse(400, { error: { message: 'Rate limit hit', code: 130429 } }))).toBe(false)
    expect((await failureOf(client(async () => jsonResponse(200, {})).client.sendMessage('../me', 't', '+1', text))).outcomeUnknown).toBe(false)
  })

  it('refuses a non-numeric phone number id instead of building another URL', async () => {
    const { client: wa, calls } = client(async () => jsonResponse(200, {}))
    expect(await failureOf(wa.sendMessage('../me', 't', '+1', text))).toMatchObject({ retryable: false })
    expect(calls).toEqual([])
  })

  it('uploads media and returns its id', async () => {
    const { client: wa, calls } = client(async () => jsonResponse(200, { id: 'media-1' }))
    const file = new Blob(['%PDF'], { type: 'application/pdf' })
    await expect(wa.uploadMedia('1234567890', 't', file, 'statement.pdf', 'application/pdf')).resolves.toEqual({ mediaId: 'media-1' })
    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/1234567890/media')
    const form = calls[0].init.body as FormData
    expect(form.get('messaging_product')).toBe('whatsapp')
    expect((form.get('file') as File).name).toBe('statement.pdf')
  })
})

describe('WhatsAppClient management calls (number verification)', () => {
  it('inspects a business token with the app access token, never putting either in an error', async () => {
    const { client: wa, calls } = client(async () =>
      jsonResponse(200, {
        data: {
          is_valid: true,
          app_id: '424242',
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['771001'] },
            { scope: 'whatsapp_business_messaging', target_ids: [771001] },
            { scope: 'business_management' },
          ],
        },
      }),
    )
    await expect(wa.debugToken('EAAG-business', '424242|app-secret')).resolves.toEqual({
      isValid: true,
      appId: '424242',
      granularScopes: [
        { scope: 'whatsapp_business_management', targetIds: ['771001'] },
        { scope: 'whatsapp_business_messaging', targetIds: ['771001'] },
        { scope: 'business_management' },
      ],
    })
    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/debug_token?input_token=EAAG-business')
    expect(calls[0].init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer 424242|app-secret' } })

    const { client: failing } = client(async () => jsonResponse(400, { error: { message: 'Invalid OAuth access token.', code: 190 } }))
    const error = await failureOf(failing.debugToken('EAAG-business', '424242|app-secret'))
    expect(error.message).not.toContain('EAAG-business')
    expect(error.message).not.toContain('app-secret')
    expect(error).toMatchObject({ graphCode: 190, retryable: false })
  })

  it("lists an account's numbers page by page with Meta's view of each", async () => {
    const pages = [
      { data: [{ id: '660001', display_phone_number: '+27 11 555 0100', verified_name: 'Atlas', quality_rating: 'GREEN', platform_type: 'CLOUD_API' }], paging: { cursors: { after: 'c1' }, next: 'https://graph/next' } },
      { data: [{ id: '660002', status: 'PENDING' }], paging: { cursors: { after: 'c2' } } },
    ]
    const { client: wa, calls } = client(async () => jsonResponse(200, pages[calls.length - 1]))
    await expect(wa.listPhoneNumbers('771001', 'token-1')).resolves.toEqual([
      { id: '660001', displayPhoneNumber: '+27 11 555 0100', verifiedName: 'Atlas', qualityRating: 'GREEN', platformType: 'CLOUD_API' },
      { id: '660002', status: 'PENDING' },
    ])
    expect(calls).toHaveLength(2)
    expect(new URL(calls[0].url).pathname).toBe('/v23.0/771001/phone_numbers')
    expect(new URL(calls[1].url).searchParams.get('after')).toBe('c1')
    expect(new URL(calls[0].url).searchParams.get('fields')).toContain('platform_type')
  })

  it('subscribes the app and registers a number with its PIN', async () => {
    const { client: wa, calls } = client(async () => jsonResponse(200, { success: true }))
    await wa.subscribeApp('771001', 'token-1')
    await wa.registerNumber('660001', 'token-1', '123456')
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', 'https://graph.facebook.com/v23.0/771001/subscribed_apps'],
      ['POST', 'https://graph.facebook.com/v23.0/660001/register'],
    ])
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ messaging_product: 'whatsapp', pin: '123456' })
    await expect(wa.registerNumber('660001', 'token-1', '12345')).rejects.toBeInstanceOf(WhatsAppApiError)
    await expect(wa.subscribeApp('not-a-meta-id', 'token-1')).rejects.toBeInstanceOf(WhatsAppApiError)
    expect(calls).toHaveLength(2)
  })

  it("reports Meta's registration rate limit with its code, not as retryable", async () => {
    const { client: wa } = client(async () => jsonResponse(400, { error: { message: 'Too many attempts', code: 133016 } }))
    expect(await failureOf(wa.registerNumber('660001', 'token-1', '123456'))).toMatchObject({ graphCode: 133016, retryable: false })
  })

  it("lists an account's message templates", async () => {
    const { client: wa } = client(async () =>
      jsonResponse(200, { data: [{ id: '9001', name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED', rejected_reason: 'NONE' }] }),
    )
    await expect(wa.listTemplates('771001', 'token-1')).resolves.toEqual([
      { id: '9001', name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED', rejectedReason: 'NONE' },
    ])
  })
})
