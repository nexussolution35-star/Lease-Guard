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
