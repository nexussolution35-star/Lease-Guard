import { describe, expect, it, vi } from 'vitest'

import { isFacebookOrigin, readEmbeddedSignupMessage, runEmbeddedSignup, type FacebookLoginResponse, type FacebookSdk } from './embeddedSignup'

const v5Finish = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH',
  version: 5,
  data: { phone_number_id: '106540352242922', messaging_account_ids: ['524126980791429'], business_id: '2729063490586005', is_on_biz_app: false },
}
const v4Finish = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '1065', waba_id: '5241', business_id: '2729' } }

describe('isFacebookOrigin', () => {
  it('trusts only https facebook.com origins', () => {
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://web.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://facebook.com')).toBe(true)
    expect(isFacebookOrigin('http://www.facebook.com')).toBe(false)
    expect(isFacebookOrigin('https://evilfacebook.com')).toBe(false)
    expect(isFacebookOrigin('https://facebook.com.evil.example')).toBe(false)
    expect(isFacebookOrigin('https://www.facebook.com:8443')).toBe(false)
    expect(isFacebookOrigin('null')).toBe(false)
  })
})

describe('readEmbeddedSignupMessage', () => {
  it('reads the v5 payload (messaging_account_ids), sent as JSON text or as an object', () => {
    expect(readEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: JSON.stringify(v5Finish) })).toEqual({
      event: 'FINISH',
      sessionInfo: v5Finish.data,
    })
    expect(readEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: v5Finish })).toEqual({ event: 'FINISH', sessionInfo: v5Finish.data })
  })

  it('reads the v4 payload (waba_id) and cancel', () => {
    expect(readEmbeddedSignupMessage({ origin: 'https://web.facebook.com', data: JSON.stringify(v4Finish) })?.sessionInfo).toEqual(v4Finish.data)
    expect(
      readEmbeddedSignupMessage({
        origin: 'https://www.facebook.com',
        data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } }),
      }),
    ).toEqual({ event: 'CANCEL', sessionInfo: { current_step: 'PHONE_NUMBER_SETUP' } })
  })

  it('ignores messages from any other origin, of another type, with an unknown event, or that are not JSON', () => {
    expect(readEmbeddedSignupMessage({ origin: 'https://evil.example', data: JSON.stringify(v5Finish) })).toBeNull()
    expect(readEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'OTHER', event: 'FINISH' }) })).toBeNull()
    expect(readEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'DONE' }) })).toBeNull()
    expect(readEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: 'not json' })).toBeNull()
  })
})

/** A window stand-in that delivers message events, and a Facebook SDK whose popup answers with `response`. */
function fakes(response: FacebookLoginResponse, messages: { origin: string; data: unknown }[], options: { messagesAfterLogin?: boolean } = {}) {
  const target = new EventTarget()
  const deliver = () => {
    for (const message of messages) target.dispatchEvent(Object.assign(new Event('message'), message))
  }
  const sdk: FacebookSdk = {
    init: vi.fn(),
    login: vi.fn((callback: (response: FacebookLoginResponse) => void) => {
      if (!options.messagesAfterLogin) deliver()
      callback(response)
      if (options.messagesAfterLogin) setTimeout(deliver, 10)
    }),
  }
  return { sdk, target }
}

const SESSION = { appId: '1234567890', configId: '987654321', graphApiVersion: 'v27.0', extras: { version: 'v5' as const } }

describe('runEmbeddedSignup', () => {
  it("opens Meta's popup for a code with the session's configuration and v5 extras, and returns the code with the session info", async () => {
    const { sdk, target } = fakes({ authResponse: { code: 'AQD-code' } }, [{ origin: 'https://www.facebook.com', data: JSON.stringify(v5Finish) }])
    await expect(runEmbeddedSignup(sdk, SESSION, { target })).resolves.toEqual({ event: 'FINISH', code: 'AQD-code', sessionInfo: v5Finish.data })
    expect(sdk.login).toHaveBeenCalledWith(expect.any(Function), {
      config_id: '987654321',
      response_type: 'code',
      override_default_response_type: true,
      extras: { version: 'v5' },
    })
  })

  it('waits briefly for the session info when the code arrives first', async () => {
    const { sdk, target } = fakes({ authResponse: { code: 'AQD-code' } }, [{ origin: 'https://www.facebook.com', data: JSON.stringify(v4Finish) }], {
      messagesAfterLogin: true,
    })
    await expect(runEmbeddedSignup(sdk, SESSION, { target, graceMs: 500 })).resolves.toEqual({ event: 'FINISH', code: 'AQD-code', sessionInfo: v4Finish.data })
  })

  it("ignores another origin's look-alike message", async () => {
    const { sdk, target } = fakes({ authResponse: null }, [
      { origin: 'https://evil.example', data: JSON.stringify(v5Finish) },
      { origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'BUSINESS' } }) },
    ])
    await expect(runEmbeddedSignup(sdk, SESSION, { target })).resolves.toEqual({ event: 'CANCEL', sessionInfo: { current_step: 'BUSINESS' } })
  })

  it('reports a finish without a code when the popup closed after the last screen', async () => {
    const { sdk, target } = fakes({ authResponse: null }, [{ origin: 'https://www.facebook.com', data: JSON.stringify(v5Finish) }])
    await expect(runEmbeddedSignup(sdk, SESSION, { target })).resolves.toEqual({ event: 'FINISH', sessionInfo: v5Finish.data })
  })

  it('treats a popup closed without any message as a cancel', async () => {
    const { sdk, target } = fakes({ authResponse: null }, [])
    await expect(runEmbeddedSignup(sdk, SESSION, { target, graceMs: 20 })).resolves.toEqual({ event: 'CANCEL' })
  })

  it('stops listening once done', async () => {
    const { sdk, target } = fakes({ authResponse: null }, [])
    const remove = vi.spyOn(target, 'removeEventListener')
    await runEmbeddedSignup(sdk, SESSION, { target, graceMs: 1 })
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
