import { Controller, Get, Header, Headers, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProperty,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import { Public } from '../../common/decorators/public.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { WHATSAPP_WEBHOOK_ROUTE } from './raw-body'
import { type WebhookReceipt, WhatsAppWebhookService } from './whatsapp-webhook.service'

export class WhatsAppWebhookReceiptDto {
  @ApiProperty({ enum: [true] }) received!: true
  @ApiProperty({ description: 'False for a signed payload that is not for WhatsApp (acknowledged, not routed)' }) queued!: boolean
}

/**
 * Meta's WhatsApp webhook, one URL for every company (`/api/v1/webhooks/whatsapp`). Public: Meta has no
 * LeaseGuard session, so the route opts out of the Supabase auth guard and authenticates Meta instead (the
 * verify token on GET, the app-secret signature on POST). The POST body is read as raw bytes by `rawWebhookBody`
 * (registered in main.ts), never parsed before its signature is checked.
 */
@ApiTags('whatsapp-webhook')
@Public()
@Controller(WHATSAPP_WEBHOOK_ROUTE)
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'verifyWhatsAppWebhook',
    summary: "Meta's webhook verification handshake (called by Meta)",
    description: 'Echoes hub.challenge when hub.mode is subscribe and hub.verify_token equals WHATSAPP_WEBHOOK_VERIFY_TOKEN.',
  })
  @ApiQuery({ name: 'hub.mode', required: true, example: 'subscribe' })
  @ApiQuery({ name: 'hub.verify_token', required: true })
  @ApiQuery({ name: 'hub.challenge', required: true })
  @ApiOkResponse({ description: 'The challenge, as plain text', schema: { type: 'string' } })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Wrong verify token or mode' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Missing or invalid challenge' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set' })
  verify(
    @Query('hub.mode') mode?: unknown,
    @Query('hub.verify_token') verifyToken?: unknown,
    @Query('hub.challenge') challenge?: unknown,
  ): string {
    return this.webhook.verifySubscription({ mode, verifyToken, challenge })
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'receiveWhatsAppWebhook',
    summary: "Meta's WhatsApp events for every company (called by Meta)",
    description:
      'Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET) before reading the body, ' +
      'then queues the payload for the worker, which routes each message by its receiving number only. The same body ' +
      'delivered again is one job. 401 when unsigned or tampered; 503 when not configured or Redis is unavailable ' +
      '(Meta retries). Bodies up to 3 MB.',
  })
  @ApiHeader({ name: 'X-Hub-Signature-256', required: true, description: 'sha256=<hex HMAC-SHA256 of the raw body>' })
  @ApiBody({ description: "Meta's webhook payload (object: whatsapp_business_account)", schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ type: WhatsAppWebhookReceiptDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'The signed body is not JSON' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or invalid signature' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'Body over 3 MB' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'WHATSAPP_APP_SECRET is not set, or background processing is unavailable' })
  receive(@Req() request: { body?: unknown }, @Headers('x-hub-signature-256') signature?: string): Promise<WebhookReceipt> {
    return this.webhook.receive(request.body, signature)
  }
}
