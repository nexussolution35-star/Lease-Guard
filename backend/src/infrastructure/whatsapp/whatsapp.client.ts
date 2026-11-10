import { z } from 'zod'

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface WhatsAppClientOptions {
  /** WHATSAPP_GRAPH_API_URL, e.g. https://graph.facebook.com */
  apiUrl: string
  /** WHATSAPP_GRAPH_API_VERSION, e.g. v23.0 */
  apiVersion: string
  /** Injected for tests; defaults to the global fetch. */
  fetch?: FetchFn
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number
}

/** One template component parameter (Cloud API shape). */
export type TemplateParameter =
  | { type: 'text'; text: string }
  | { type: 'document'; document: { id: string; filename: string } }

export interface TemplateComponent {
  type: 'header' | 'body'
  parameters: TemplateParameter[]
}

/** The message part of a Cloud API `POST /{phone-number-id}/messages` body. */
export type WhatsAppMessage =
  | { type: 'text'; text: { body: string; preview_url: false } }
  | { type: 'template'; template: { name: string; language: { code: string }; components: TemplateComponent[] } }
  | { type: 'document'; document: { id: string; filename: string; caption?: string } }

/**
 * A Graph API request failed. `retryable` is true for network errors, timeouts, HTTP 408/429/5xx and
 * Graph errors Meta documents as temporary or throttling (codes 1, 2, 4, 80007, 130429, 131056), which
 * Meta can return with HTTP 400. Every other 4xx (invalid recipient, template, token, permissions) is
 * permanent and must not be retried. Messages never include the access token.
 *
 * `outcomeUnknown` is true when Meta may have accepted the request although the call failed: a network
 * error or timeout after the request was sent (no HTTP status), an HTTP 5xx that is not a throttling
 * code, or a success response without the expected id. For a send, retrying such a failure could
 * message the recipient twice, so the caller must not retry it even when `retryable` is true.
 */
export class WhatsAppApiError extends Error {
  readonly retryable: boolean
  readonly status: number | undefined
  /** Graph API error code, when the response carried one. */
  readonly graphCode: number | undefined
  readonly outcomeUnknown: boolean

  constructor(message: string, options: { retryable: boolean; status?: number; graphCode?: number; outcomeUnknown?: boolean }) {
    super(message)
    this.name = 'WhatsAppApiError'
    this.retryable = options.retryable
    this.status = options.status
    this.graphCode = options.graphCode
    this.outcomeUnknown = options.outcomeUnknown ?? false
  }
}

/** Graph error codes for temporary failures and rate limiting. */
export const RETRYABLE_GRAPH_CODES: readonly number[] = [1, 2, 4, 80007, 130429, 131056]
/** Graph error codes for rate limiting: the request was refused, so nothing was accepted. */
export const THROTTLING_GRAPH_CODES: readonly number[] = [4, 80007, 130429, 131056]

const graphErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
})
const sendResponseSchema = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) })
const mediaResponseSchema = z.object({ id: z.string().min(1) })

const PHONE_NUMBER_ID = /^\d{1,32}$/
const DEFAULT_TIMEOUT_MS = 30_000

/** WhatsApp Cloud API client (Meta Graph API). Stateless: the access token is passed per call. */
export class WhatsAppClient {
  private readonly baseUrl: string
  private readonly fetchFn: FetchFn
  private readonly timeoutMs: number

  constructor(options: WhatsAppClientOptions) {
    this.baseUrl = `${options.apiUrl.replace(/\/+$/, '')}/${options.apiVersion}`
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Sends one message; resolves with the WhatsApp message id (`wamid…`). */
  async sendMessage(phoneNumberId: string, accessToken: string, to: string, message: WhatsAppMessage): Promise<{ messageId: string }> {
    const body = JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g, ''), ...message })
    const json = await this.request(this.url(phoneNumberId, 'messages'), accessToken, {
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    const parsed = sendResponseSchema.safeParse(json)
    if (!parsed.success) {
      // A success status without a message id: Meta may well have accepted the message.
      throw new WhatsAppApiError('Unexpected WhatsApp send response: no message id', { retryable: false, outcomeUnknown: true })
    }
    return { messageId: parsed.data.messages[0].id }
  }

  /** Uploads a document for use in a message; resolves with the media id. */
  async uploadMedia(phoneNumberId: string, accessToken: string, file: Blob, fileName: string, mimeType: string): Promise<{ mediaId: string }> {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', mimeType)
    form.append('file', new Blob([file], { type: mimeType }), fileName)
    const json = await this.request(this.url(phoneNumberId, 'media'), accessToken, { body: form })
    const parsed = mediaResponseSchema.safeParse(json)
    if (!parsed.success) throw new WhatsAppApiError('Unexpected WhatsApp media response: no media id', { retryable: false })
    return { mediaId: parsed.data.id }
  }

  private url(phoneNumberId: string, edge: 'messages' | 'media'): string {
    if (!PHONE_NUMBER_ID.test(phoneNumberId)) {
      throw new WhatsAppApiError('The WhatsApp phone number id is not a numeric Graph API id', { retryable: false })
    }
    return `${this.baseUrl}/${phoneNumberId}/${edge}`
  }

  private async request(url: string, accessToken: string, init: { body: string | FormData; headers?: Record<string, string> }): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      // The request may have reached Meta before the connection failed or the timeout fired.
      throw new WhatsAppApiError(`WhatsApp Graph API unreachable (${reason})`, { retryable: true, outcomeUnknown: true })
    }
    const json: unknown = await response.json().catch(() => undefined)
    if (response.ok) return json

    const parsed = graphErrorSchema.safeParse(json)
    const graphCode = parsed.success ? parsed.data.error.code : undefined
    const detail = parsed.success ? parsed.data.error.message : 'no error details'
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500 ||
      (graphCode !== undefined && RETRYABLE_GRAPH_CODES.includes(graphCode))
    const throttled = graphCode !== undefined && THROTTLING_GRAPH_CODES.includes(graphCode)
    throw new WhatsAppApiError(
      `WhatsApp Graph API returned HTTP ${response.status}${graphCode === undefined ? '' : ` (code ${graphCode})`}: ${detail}`,
      {
        retryable,
        status: response.status,
        ...(graphCode === undefined ? {} : { graphCode }),
        // A 5xx may come from a failure after the request was processed; a 4xx is a refusal.
        outcomeUnknown: response.status >= 500 && !throttled,
      },
    )
  }
}
