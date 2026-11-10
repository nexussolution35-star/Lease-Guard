import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { isSameSecret, isValidMetaSignature, payloadSha256 } from './webhook-signature'

/** Meta's hub.challenge is a number; anything echoed back is limited to safe characters. */
const CHALLENGE = /^[A-Za-z0-9._-]{1,512}$/

export interface SubscriptionQuery {
  mode?: unknown
  verifyToken?: unknown
  challenge?: unknown
}

/** What happened to a signed payload: queued for routing, or not a WhatsApp Business Account payload. */
export interface WebhookReceipt {
  received: true
  queued: boolean
}

/**
 * Meta's one webhook for every company. The API only authenticates: the handshake by the verify token, each
 * POST by Meta's signature over the raw bytes. A signed WhatsApp payload is queued unchanged for the worker,
 * which stores and routes it by receiving number (ADR 0002); the API holds no service-role key and writes
 * nothing here. Answering fast with 200 (Meta retries for up to 7 days otherwise) and 503 while Redis is down
 * (so Meta retries later) keeps every delivery.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name)

  constructor(
    @Inject(API_ENV) private readonly env: Pick<ApiEnv, 'WHATSAPP_APP_SECRET' | 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'>,
    private readonly queues: QueueProducer,
  ) {}

  /** GET handshake: echoes hub.challenge when hub.mode is subscribe and hub.verify_token matches. */
  verifySubscription(query: SubscriptionQuery): string {
    const expected = this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    if (!expected) throw new ServiceUnavailableException('The WhatsApp webhook is not configured (WHATSAPP_WEBHOOK_VERIFY_TOKEN)')
    if (query.mode !== 'subscribe' || typeof query.verifyToken !== 'string' || !isSameSecret(query.verifyToken, expected)) {
      throw new ForbiddenException('The webhook verification failed')
    }
    if (typeof query.challenge !== 'string' || !CHALLENGE.test(query.challenge)) {
      throw new BadRequestException('hub.challenge is missing or invalid')
    }
    return query.challenge
  }

  /** POST: checks the signature over the raw bytes BEFORE parsing, then queues the payload once per body. */
  async receive(rawBody: unknown, signature: string | undefined, receivedAt: Date = new Date()): Promise<WebhookReceipt> {
    const secret = this.env.WHATSAPP_APP_SECRET
    if (!secret) throw new ServiceUnavailableException('The WhatsApp webhook is not configured (WHATSAPP_APP_SECRET)')
    if (!Buffer.isBuffer(rawBody) || !isValidMetaSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Missing or invalid X-Hub-Signature-256')
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new BadRequestException('The webhook payload is not JSON')
    }
    const object = typeof payload === 'object' && payload !== null && 'object' in payload ? payload.object : undefined
    if (object !== 'whatsapp_business_account') {
      // Signed by Meta, but not a WhatsApp payload (another product of the app): acknowledged, not routed.
      this.logger.warn({ object: typeof object === 'string' ? object.slice(0, 60) : null }, 'Ignored a webhook payload that is not for WhatsApp')
      return { received: true, queued: false }
    }

    const sha = payloadSha256(rawBody)
    // enqueueOrRetry, not enqueue: the job id is the body's SHA-256 and failed jobs are kept, so `enqueue` would
    // be a no-op for Meta's redelivery of a body whose job failed all its attempts, and the messages would be
    // lost after a 200. Retrying is safe: the worker skips an event already `processed` and deduplicates messages.
    const { outcome } = await this.queues.enqueueOrRetry('whatsapp-webhook', {
      payloadSha256: sha,
      body: rawBody.toString('utf8'),
      receivedAt: receivedAt.toISOString(),
    })
    if (outcome === 'retried') this.logger.log({ payloadSha256: sha }, 'Retried a failed WhatsApp webhook job on redelivery')
    return { received: true, queued: true }
  }
}
