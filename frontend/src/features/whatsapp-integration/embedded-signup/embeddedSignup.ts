/**
 * Meta Embedded Signup in the browser: the popup opened with the Facebook JavaScript SDK, and the
 * `WA_EMBEDDED_SIGNUP` message Meta posts to this window. Only messages from https facebook.com origins
 * are read. The browser forwards Meta's event and data unchanged; the API reads the v5 shape
 * (`messaging_account_ids`) with the v4 shape (`waba_id`) as fallback, and exchanges the code.
 */

export const EMBEDDED_SIGNUP_EVENTS = [
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_GRANT_ONLY_API_ACCESS',
  'CANCEL',
  'ERROR',
] as const
export type EmbeddedSignupEvent = (typeof EMBEDDED_SIGNUP_EVENTS)[number]

/** Meta's message `data`, as received (snake_case). */
export type EmbeddedSignupSessionInfo = Record<string, unknown>

export interface EmbeddedSignupMessage {
  event: EmbeddedSignupEvent
  sessionInfo?: EmbeddedSignupSessionInfo
}

/** What the popup produced: Meta's event and data, and the one-time code when the customer clicked Finish. */
export interface EmbeddedSignupOutcome extends EmbeddedSignupMessage {
  code?: string
}

export interface FacebookLoginResponse {
  authResponse?: { code?: string | null } | null
  status?: string
}

/** The part of the Facebook JavaScript SDK (`window.FB`) Embedded Signup uses. */
export interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: { config_id: string; response_type: 'code'; override_default_response_type: true; extras: { version: 'v5' } },
  ): void
}

/** What the API's onboarding session provides for the popup. */
export interface EmbeddedSignupSession {
  appId: string
  configId: string
  graphApiVersion: string
  extras: { version: 'v5' }
}

/** https facebook.com or one of its subdomains, on the default port. Meta does not document the exact list. */
export function isFacebookOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.port === '' && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Meta's Embedded Signup message, or null for any other message (other origins, types or shapes). */
export function readEmbeddedSignupMessage(message: { origin: string; data: unknown }): EmbeddedSignupMessage | null {
  if (!isFacebookOrigin(message.origin)) return null
  let payload: unknown = message.data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }
  if (!isRecord(payload) || payload.type !== 'WA_EMBEDDED_SIGNUP') return null
  const event = EMBEDDED_SIGNUP_EVENTS.find((known) => known === payload.event)
  if (!event) return null
  return isRecord(payload.data) ? { event, sessionInfo: payload.data } : { event }
}

/**
 * Opens Meta's popup and resolves with what it produced. Meta posts its message before or just after the
 * login callback, so after the callback this waits up to `graceMs` for it. A popup closed without any
 * message counts as a cancel. The code lives about 30 seconds: send the outcome to the API at once.
 */
export function runEmbeddedSignup(
  sdk: FacebookSdk,
  session: EmbeddedSignupSession,
  options: { target?: EventTarget; graceMs?: number } = {},
): Promise<EmbeddedSignupOutcome> {
  const target = options.target ?? window
  const graceMs = options.graceMs ?? 2000
  return new Promise((resolve) => {
    let message: EmbeddedSignupMessage | null = null
    let login: { code?: string } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = () => {
      if (timer !== undefined) clearTimeout(timer)
      target.removeEventListener('message', onMessage)
      const code = login?.code
      const base: EmbeddedSignupMessage = message ?? { event: 'CANCEL' }
      resolve(code ? { ...base, code } : base)
    }
    function onMessage(event: Event) {
      const read = readEmbeddedSignupMessage(event as MessageEvent)
      if (!read) return
      message = read
      if (login) finish()
    }

    target.addEventListener('message', onMessage)
    sdk.login(
      (response) => {
        const code = response.authResponse?.code
        login = code ? { code } : {}
        if (message) finish()
        else timer = setTimeout(finish, graceMs)
      },
      { config_id: session.configId, response_type: 'code', override_default_response_type: true, extras: session.extras },
    )
  })
}
