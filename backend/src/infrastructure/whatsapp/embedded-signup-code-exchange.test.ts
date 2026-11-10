import { describe, expect, it } from 'vitest'

import { EmbeddedSignupCodeExchange, EmbeddedSignupExchangeError } from './embedded-signup-code-exchange'

const SETTINGS = { apiUrl: 'https://graph.example/', apiVersion: 'v27.0', appId: '1234567890', appSecret: 'the-app-secret' }
const CODE = 'AQD-one-time-code'
const TOKEN = 'EAAG-business-token-0123456789'

function recordingFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  }
  return { fetch, calls }
}

async function failureOf(promise: Promise<unknown>): Promise<EmbeddedSignupExchangeError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof EmbeddedSignupExchangeError) return error
    throw error
  }
  throw new Error('expected the exchange to fail')
}

describe('EmbeddedSignupCodeExchange', () => {
  it('exchanges the code server to server for the business token', async () => {
    const { fetch, calls } = recordingFetch(200, { access_token: TOKEN, token_type: 'bearer' })
    await expect(new EmbeddedSignupCodeExchange({ ...SETTINGS, fetch }).exchange(CODE)).resolves.toEqual({ accessToken: TOKEN })

    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect(`${url.origin}${url.pathname}`).toBe('https://graph.example/v27.0/oauth/access_token')
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: '1234567890', client_secret: 'the-app-secret', code: CODE })
    expect(calls[0].init.method).toBe('GET')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it("reports a code Meta refused (expired, used or not this app's) without the code, secret or Meta's text", async () => {
    const { fetch } = recordingFetch(400, {
      error: { message: `This authorization code has expired. code=${CODE}`, type: 'OAuthException', code: 100, error_subcode: 36007 },
    })
    const error = await failureOf(new EmbeddedSignupCodeExchange({ ...SETTINGS, fetch }).exchange(CODE))
    expect(error.reason).toBe('code_rejected')
    expect(error.graphCode).toBe(100)
    for (const secret of [CODE, 'the-app-secret', 'expired']) expect(error.message).not.toContain(secret)
  })

  it('reports Meta unreachable or failing as temporary', async () => {
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as (url: string, init: RequestInit) => Promise<Response>
    expect((await failureOf(new EmbeddedSignupCodeExchange({ ...SETTINGS, fetch: down }).exchange(CODE))).reason).toBe('meta_unavailable')
    const { fetch } = recordingFetch(503, {})
    expect((await failureOf(new EmbeddedSignupCodeExchange({ ...SETTINGS, fetch }).exchange(CODE))).reason).toBe('meta_unavailable')
  })

  it('refuses a success response without a usable token', async () => {
    for (const body of [{}, { access_token: '' }, { access_token: 'has spaces in it but is long' }]) {
      const { fetch } = recordingFetch(200, body)
      expect((await failureOf(new EmbeddedSignupCodeExchange({ ...SETTINGS, fetch }).exchange(CODE))).reason).toBe('unexpected_response')
    }
  })
})
