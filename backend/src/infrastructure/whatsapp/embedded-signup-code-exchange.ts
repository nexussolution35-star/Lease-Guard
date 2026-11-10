import { z } from 'zod'

import type { FetchFn } from './whatsapp.client'

export interface EmbeddedSignupCodeExchangeOptions {
  /** WHATSAPP_GRAPH_API_URL, e.g. https://graph.facebook.com */
  apiUrl: string
  /** WHATSAPP_GRAPH_API_VERSION, e.g. v27.0 */
  apiVersion: string
  /** WHATSAPP_APP_ID */
  appId: string
  /** WHATSAPP_APP_SECRET (API only) */
  appSecret: string
  /** Injected for tests; defaults to the global fetch. */
  fetch?: FetchFn
  /** The code lives about 30 seconds, so the exchange gives up well before. Default 10 s. */
  timeoutMs?: number
}

/**
 * Why an exchange failed, for a user-safe message:
 * - `code_rejected`: Meta refused the code (expired after ~30 s, already used, or not issued to this app);
 * - `meta_unavailable`: network error, timeout or a Meta 5xx / throttling;
 * - `unexpected_response`: Meta answered without a usable token.
 */
export type EmbeddedSignupExchangeFailure = 'code_rejected' | 'meta_unavailable' | 'unexpected_response'

/** A failed code exchange. The message never contains the code, the app secret, a token or Meta's own text. */
export class EmbeddedSignupExchangeError extends Error {
  readonly reason: EmbeddedSignupExchangeFailure
  readonly status: number | undefined
  readonly graphCode: number | undefined

  constructor(reason: EmbeddedSignupExchangeFailure, options: { status?: number; graphCode?: number } = {}) {
    const detail = [options.status === undefined ? null : `HTTP ${options.status}`, options.graphCode === undefined ? null : `code ${options.graphCode}`]
      .filter(Boolean)
      .join(', ')
    super(`Embedded Signup code exchange failed: ${reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'EmbeddedSignupExchangeError'
    this.reason = reason
    this.status = options.status
    this.graphCode = options.graphCode
  }
}

const graphErrorSchema = z.object({ error: z.object({ code: z.number().optional() }) })
// Tokens are opaque, variable-length strings (research §4.2); anything with whitespace is not one.
const tokenResponseSchema = z.object({ access_token: z.string().min(20).max(4096).regex(/^\S+$/) })

/** Graph codes for throttling or temporary errors: the code was not judged, so it is not "rejected". */
const TEMPORARY_GRAPH_CODES: readonly number[] = [1, 2, 4, 17, 32, 613]

/**
 * Exchanges an Embedded Signup code for the business's token (business integration system user token):
 * `GET {graph}/{version}/oauth/access_token?client_id&client_secret&code`, server to server as Meta requires.
 * Callers must not log the code, the URL or the token.
 */
export class EmbeddedSignupCodeExchange {
  private readonly endpoint: string
  private readonly fetchFn: FetchFn
  private readonly timeoutMs: number

  constructor(private readonly options: EmbeddedSignupCodeExchangeOptions) {
    this.endpoint = `${options.apiUrl.replace(/\/+$/, '')}/${options.apiVersion}/oauth/access_token`
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async exchange(code: string): Promise<{ accessToken: string }> {
    const url = new URL(this.endpoint)
    url.searchParams.set('client_id', this.options.appId)
    url.searchParams.set('client_secret', this.options.appSecret)
    url.searchParams.set('code', code)

    let response: Response
    try {
      response = await this.fetchFn(url.toString(), { method: 'GET', signal: AbortSignal.timeout(this.timeoutMs) })
    } catch {
      throw new EmbeddedSignupExchangeError('meta_unavailable')
    }
    const json: unknown = await response.json().catch(() => undefined)
    if (response.ok) {
      const parsed = tokenResponseSchema.safeParse(json)
      if (!parsed.success) throw new EmbeddedSignupExchangeError('unexpected_response', { status: response.status })
      return { accessToken: parsed.data.access_token }
    }
    const graphCode = graphErrorSchema.safeParse(json).data?.error.code
    const temporary =
      response.status === 408 || response.status === 429 || response.status >= 500 || (graphCode !== undefined && TEMPORARY_GRAPH_CODES.includes(graphCode))
    throw new EmbeddedSignupExchangeError(temporary ? 'meta_unavailable' : 'code_rejected', {
      status: response.status,
      ...(graphCode === undefined ? {} : { graphCode }),
    })
  }
}
