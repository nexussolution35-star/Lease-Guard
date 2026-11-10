import type { IncomingMessage, ServerResponse } from 'node:http'

/** The webhook's route below the API prefix: `/api/v1/webhooks/whatsapp`. */
export const WHATSAPP_WEBHOOK_ROUTE = 'webhooks/whatsapp'

/** Meta sends up to 1,000 updates per request and payloads of up to 3 MB. */
export const MAX_WEBHOOK_BODY_BYTES = 3 * 1024 * 1024

type RawBodyRequest = IncomingMessage & { body?: unknown }

/**
 * Express middleware for the webhook route only: reads the POST body as raw bytes (`req.body` becomes a Buffer),
 * because Meta's signature covers the exact bytes and parsed JSON cannot be re-serialised to them. It is
 * registered before Nest's JSON parser, which then skips the already-read request, so the global JSON limit stays
 * as it is for every other route. A body over `limit` is answered 413 without being kept.
 */
export function rawWebhookBody(limit = MAX_WEBHOOK_BODY_BYTES) {
  return (req: RawBodyRequest, res: ServerResponse, next: (error?: unknown) => void): void => {
    if (req.method !== 'POST') {
      next()
      return
    }
    const tooLarge = () => {
      res.statusCode = 413
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ statusCode: 413, error: 'Payload Too Large', message: 'The webhook payload is too large', requestId: null }))
    }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      tooLarge()
      req.resume()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        chunks.length = 0
        tooLarge()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      req.body = Buffer.concat(chunks, size)
      next()
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      next(error)
    })
  }
}
