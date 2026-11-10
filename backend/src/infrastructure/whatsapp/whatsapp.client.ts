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
const successSchema = z.object({ success: z.literal(true) })
const pagingSchema = z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional()
const debugTokenSchema = z.object({
  data: z.object({
    is_valid: z.boolean(),
    app_id: z.union([z.string(), z.number()]).optional(),
    granular_scopes: z.array(z.object({ scope: z.string(), target_ids: z.array(z.union([z.string(), z.number()])).optional() })).optional(),
  }),
})
const phoneNumberSchema = z.object({
  id: z.string(),
  display_phone_number: z.string().optional(),
  verified_name: z.string().optional(),
  quality_rating: z.string().optional(),
  code_verification_status: z.string().optional(),
  name_status: z.string().optional(),
  status: z.string().optional(),
  platform_type: z.string().optional(),
})
const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.string(),
  status: z.string(),
  rejected_reason: z.string().optional(),
})

/** What Meta's debug_token reports about a business token. */
export interface TokenInspection {
  isValid: boolean
  appId?: string
  /** Each permission with the objects (account ids) it covers; no `targetIds` means not limited to objects. */
  granularScopes: { scope: string; targetIds?: string[] }[]
}

/** A number as Meta lists it in its WhatsApp Business Account. */
export interface MetaPhoneNumber {
  id: string
  displayPhoneNumber?: string
  verifiedName?: string
  qualityRating?: string
  codeVerificationStatus?: string
  nameStatus?: string
  /** Meta's status, e.g. CONNECTED, PENDING. */
  status?: string
  /** CLOUD_API once the number is registered for the Cloud API. */
  platformType?: string
}

/** A message template Meta holds for an account. */
export interface MetaMessageTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  rejectedReason?: string
}

const META_ID = /^\d{1,32}$/
const PHONE_NUMBER_FIELDS = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,platform_type'
const TEMPLATE_FIELDS = 'id,name,language,category,status,rejected_reason'
/** Pages read from a list edge before giving up (100 items each). */
const MAX_PAGES = 20

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

  /**
   * Meta's debug_token for `inputToken`, authenticated with the app access token (`<app id>|<app secret>`).
   * Neither token appears in errors.
   */
  async debugToken(inputToken: string, appAccessToken: string): Promise<TokenInspection> {
    const url = new URL(`${this.baseUrl}/debug_token`)
    url.searchParams.set('input_token', inputToken)
    const json = await this.request(url.toString(), appAccessToken, { method: 'GET' })
    const parsed = debugTokenSchema.safeParse(json)
    if (!parsed.success) throw new WhatsAppApiError('Unexpected debug_token response', { retryable: false })
    const { data } = parsed.data
    return {
      isValid: data.is_valid,
      ...(data.app_id === undefined ? {} : { appId: String(data.app_id) }),
      granularScopes: (data.granular_scopes ?? []).map((scope) => ({
        scope: scope.scope,
        ...(scope.target_ids ? { targetIds: scope.target_ids.map(String) } : {}),
      })),
    }
  }

  /** The numbers of a WhatsApp Business Account with Meta's view of each. */
  async listPhoneNumbers(businessAccountId: string, accessToken: string): Promise<MetaPhoneNumber[]> {
    const rows = await this.listEdge(this.metaUrl(businessAccountId, 'phone_numbers'), accessToken, PHONE_NUMBER_FIELDS, phoneNumberSchema)
    return rows.map((row) => ({
      id: row.id,
      ...(row.display_phone_number ? { displayPhoneNumber: row.display_phone_number } : {}),
      ...(row.verified_name ? { verifiedName: row.verified_name } : {}),
      ...(row.quality_rating ? { qualityRating: row.quality_rating } : {}),
      ...(row.code_verification_status ? { codeVerificationStatus: row.code_verification_status } : {}),
      ...(row.name_status ? { nameStatus: row.name_status } : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(row.platform_type ? { platformType: row.platform_type } : {}),
    }))
  }

  /** Subscribes this app to the account's webhooks (`POST /{account}/subscribed_apps`); idempotent at Meta. */
  async subscribeApp(businessAccountId: string, accessToken: string): Promise<void> {
    const json = await this.request(this.metaUrl(businessAccountId, 'subscribed_apps'), accessToken, { method: 'POST' })
    if (!successSchema.safeParse(json).success) throw new WhatsAppApiError('Meta did not confirm the webhook subscription', { retryable: false })
  }

  /** Registers the number for the Cloud API with its two-step verification PIN. The PIN never appears in errors. */
  async registerNumber(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
    if (!/^\d{6}$/.test(pin)) throw new WhatsAppApiError('The registration PIN must be 6 digits', { retryable: false })
    const json = await this.request(this.metaUrl(phoneNumberId, 'register'), accessToken, {
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!successSchema.safeParse(json).success) throw new WhatsAppApiError('Meta did not confirm the registration', { retryable: false })
  }

  /** Every message template of a WhatsApp Business Account. */
  async listTemplates(businessAccountId: string, accessToken: string): Promise<MetaMessageTemplate[]> {
    const rows = await this.listEdge(this.metaUrl(businessAccountId, 'message_templates'), accessToken, TEMPLATE_FIELDS, templateSchema)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      ...(row.rejected_reason ? { rejectedReason: row.rejected_reason } : {}),
    }))
  }

  private async listEdge<T>(edgeUrl: string, accessToken: string, fields: string, item: z.ZodType<T>): Promise<T[]> {
    const pageSchema = z.object({ data: z.array(item), paging: pagingSchema })
    const items: T[] = []
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(edgeUrl)
      url.searchParams.set('fields', fields)
      url.searchParams.set('limit', '100')
      if (after) url.searchParams.set('after', after)
      const parsed = pageSchema.safeParse(await this.request(url.toString(), accessToken, { method: 'GET' }))
      if (!parsed.success) throw new WhatsAppApiError('Unexpected Graph API list response', { retryable: false })
      items.push(...parsed.data.data)
      after = parsed.data.paging?.next ? parsed.data.paging.cursors?.after : undefined
      if (!after) return items
    }
    throw new WhatsAppApiError(`The Graph API list has more than ${MAX_PAGES * 100} items`, { retryable: false })
  }

  private metaUrl(id: string, edge: string): string {
    if (!META_ID.test(id)) throw new WhatsAppApiError('The Meta id is not a numeric Graph API id', { retryable: false })
    return `${this.baseUrl}/${id}/${edge}`
  }

  private url(phoneNumberId: string, edge: 'messages' | 'media'): string {
    if (!PHONE_NUMBER_ID.test(phoneNumberId)) {
      throw new WhatsAppApiError('The WhatsApp phone number id is not a numeric Graph API id', { retryable: false })
    }
    return `${this.baseUrl}/${phoneNumberId}/${edge}`
  }

  private async request(
    url: string,
    accessToken: string,
    init: { method?: 'GET' | 'POST'; body?: string | FormData; headers?: Record<string, string> },
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(url, {
        method: init.method ?? 'POST',
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        ...(init.body === undefined ? {} : { body: init.body }),
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
