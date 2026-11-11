import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * A stand-in for Meta's Graph API on 127.0.0.1 (never Meta): the calls LeaseGuard makes for Embedded Signup (code
 * exchange, API process), number verification and sending (worker). Each business has its own code, business token,
 * WhatsApp Business Account and number, and a token only works on its own business's ids: a call that uses one
 * business's token on another business's account or number is refused, as Meta would, and recorded as refused.
 */

export interface FakeBusiness {
  /** The one-time code Embedded Signup hands the browser. */
  code: string
  /** The business token the code is exchanged for. */
  token: string
  businessAccountId: string
  phoneNumberId: string
  displayPhoneNumber: string
  verifiedName: string
  /** Meta's id of the account's one approved UTILITY template (`hello_world`, no placeholders). */
  templateId: string
}

export interface GraphRequest {
  method: string
  /** Without the version prefix, e.g. `/123/messages`. */
  path: string
  query: Record<string, string>
  /** The bearer token the caller sent (fake tokens only). */
  token: string | null
  body: unknown
  /** The business whose token was used, when it is one of them. */
  business: string | null
  /** The status the fake answered. */
  status: number
  /** For a send: the WhatsApp message id it returned. */
  messageId?: string
}

export interface FakeMetaApp {
  appId: string
  appSecret: string
  graphVersion: string
}

const permissionError = { error: { message: 'Unsupported request - permission error', type: 'OAuthException', code: 200 } }

export class FakeMetaGraph {
  readonly requests: GraphRequest[] = []
  private sendCount = 0

  private constructor(
    private readonly server: Server,
    readonly url: string,
    private readonly app: FakeMetaApp,
    private readonly businesses: Readonly<Record<string, FakeBusiness>>,
  ) {}

  static async start(app: FakeMetaApp, businesses: Readonly<Record<string, FakeBusiness>>, port: number): Promise<FakeMetaGraph> {
    let fake: FakeMetaGraph | undefined
    const server = createServer((req, res) => {
      void fake?.handle(req, res)
    })
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    fake = new FakeMetaGraph(server, `http://127.0.0.1:${port}`, app, businesses)
    return fake
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
      // Callers keep idle keep-alive sockets open; close them so shutting down does not wait for their timeout.
      this.server.closeAllConnections()
    })
  }

  /** Messages sent through the Cloud API (`POST /{phone-number-id}/messages`) that Meta accepted. */
  sends(): GraphRequest[] {
    return this.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages') && r.status === 200)
  }

  /** Calls refused because a business token was used on ids that are not its own business's. */
  refused(): GraphRequest[] {
    return this.requests.filter((r) => r.status === 403)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const prefix = `/${this.app.graphVersion}`
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
    const raw = await new Promise<string>((resolve) => {
      let data = ''
      req.on('data', (chunk: Buffer) => (data += chunk.toString()))
      req.on('end', () => resolve(data))
    })
    let body: unknown = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = raw
    }
    const business = Object.entries(this.businesses).find(([, b]) => b.token === token)?.[0] ?? null
    const record: GraphRequest = { method: req.method ?? 'GET', path, query: Object.fromEntries(url.searchParams), token, body, business, status: 200 }
    this.requests.push(record)

    const reply = (status: number, json: unknown) => {
      record.status = status
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(json))
    }

    if (!url.pathname.startsWith(prefix)) return reply(404, { error: { message: 'Unknown version', code: 100 } })

    if (req.method === 'GET' && path === '/oauth/access_token') {
      const owner = Object.values(this.businesses).find((b) => b.code === url.searchParams.get('code'))
      const appOk = url.searchParams.get('client_id') === this.app.appId && url.searchParams.get('client_secret') === this.app.appSecret
      if (!owner || !appOk) {
        return reply(400, { error: { message: 'This authorization code has expired.', type: 'OAuthException', code: 100, error_subcode: 36007 } })
      }
      return reply(200, { access_token: owner.token, token_type: 'bearer' })
    }

    if (req.method === 'GET' && path === '/debug_token') {
      if (token !== `${this.app.appId}|${this.app.appSecret}`) return reply(400, { error: { message: 'Invalid app access token', type: 'OAuthException', code: 190 } })
      const inspected = Object.values(this.businesses).find((b) => b.token === url.searchParams.get('input_token'))
      if (!inspected) return reply(200, { data: { is_valid: false } })
      const targets = [inspected.businessAccountId]
      return reply(200, {
        data: {
          is_valid: true,
          app_id: this.app.appId,
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: targets },
            { scope: 'whatsapp_business_messaging', target_ids: targets },
          ],
        },
      })
    }

    const [, id, edge] = path.split('/')
    const owner = business ? this.businesses[business] : undefined
    if (!owner) return reply(401, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } })
    const ownAccount = id === owner.businessAccountId
    const ownNumber = id === owner.phoneNumberId

    if (req.method === 'GET' && edge === 'phone_numbers') {
      if (!ownAccount) return reply(403, permissionError)
      return reply(200, {
        data: [
          {
            id: owner.phoneNumberId,
            display_phone_number: owner.displayPhoneNumber,
            verified_name: owner.verifiedName,
            quality_rating: 'GREEN',
            code_verification_status: 'VERIFIED',
            name_status: 'APPROVED',
            status: 'CONNECTED',
            platform_type: 'CLOUD_API',
          },
        ],
      })
    }
    if (req.method === 'POST' && edge === 'subscribed_apps') {
      if (!ownAccount) return reply(403, permissionError)
      return reply(200, { success: true })
    }
    if (req.method === 'GET' && edge === 'message_templates') {
      if (!ownAccount) return reply(403, permissionError)
      return reply(200, { data: [{ id: owner.templateId, name: 'hello_world', language: 'en_US', category: 'UTILITY', status: 'APPROVED' }] })
    }
    if (req.method === 'POST' && edge === 'register') {
      if (!ownNumber) return reply(403, permissionError)
      return reply(200, { success: true })
    }
    if (req.method === 'POST' && edge === 'messages') {
      if (!ownNumber) return reply(403, permissionError)
      this.sendCount += 1
      record.messageId = `wamid.fake-${owner.phoneNumberId}-${this.sendCount}`
      const to = typeof body === 'object' && body !== null && 'to' in body ? String(body.to) : ''
      return reply(200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: record.messageId }] })
    }
    return reply(404, { error: { message: `Unknown path ${path}`, code: 100 } })
  }
}
