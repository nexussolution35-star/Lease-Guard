import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { EntityId, WhatsAppMessageTemplate } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { API_ENV } from '../../config/tokens'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { type EnqueueOutcome, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { RegistrationPins } from '../../infrastructure/whatsapp/registration-pins'

/** A verification the API asked the worker for. */
export interface VerificationRequest {
  numberId: EntityId
  /**
   * `queued`: a new run will start; `already_running`: a run is waiting or in progress (for `register`, only a
   * waiting or delayed run, which reads the PIN when it reaches the registration step).
   */
  status: 'queued' | 'already_running'
  message: string
}

/** The outcome of a disconnect, for the admin. */
export interface DisconnectResult {
  numberId: EntityId
  status: 'disconnected'
  /** The stored business token was deleted (false when another number in use still holds it, or it is an env token). */
  tokenRemoved: boolean
  message: string
}

const TEMPLATE_COLUMNS = 'id, business_account_id, meta_template_id, name, language, category, status, rejected_reason, synced_at, status_updated_at'

const DATE_TIME = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' })

/**
 * What company admins do with a business number after Embedded Signup: ask the worker to verify it (again),
 * hand it the registration PIN, disconnect it; and the templates Meta holds for the company's accounts.
 *
 * The API never calls Meta with a business token (only the worker reads tokens). Verification runs in the
 * worker's `whatsapp-number-verification` queue with a deterministic job id per number, so repeated requests
 * never start parallel runs. The PIN is handed over through a single-use Redis key (RegistrationPins) and is
 * never stored, logged or put in a job payload.
 */
@Injectable()
export class WhatsAppNumbersService {
  private readonly logger = new Logger(WhatsAppNumbersService.name)
  private pinStore: RegistrationPins | undefined

  constructor(
    private readonly queues: QueueProducer,
    @Inject(API_ENV) private readonly env: { QUEUE_PREFIX: string },
  ) {}

  /** Verify a number of the company (again). 404 for a number that is not the company's; 409 when disconnected. */
  async verify(db: DbClient, companyId: EntityId, numberId: EntityId): Promise<VerificationRequest> {
    const number = await this.number(db, companyId, numberId)
    if (number.connection_status === 'disconnected') {
      throw new ConflictException('This number was disconnected. Connect it again with Connect WhatsApp Business.')
    }
    return this.enqueue(companyId, numberId, 'LeaseGuard is verifying the number with Meta. The steps below update as each check completes.')
  }

  /**
   * Registers a number for the Cloud API with the admin's 6-digit PIN: the PIN goes to the worker, which uses
   * it once. 429 while Meta's registration lock lasts (no new attempt reaches Meta), 409 when the number is
   * connected or disconnected, or while a verification run is in progress (the PIN is then not stored).
   */
  async register(db: DbClient, companyId: EntityId, numberId: EntityId, pin: string): Promise<VerificationRequest> {
    const number = await this.number(db, companyId, numberId)
    if (number.connection_status === 'disconnected') {
      throw new ConflictException('This number was disconnected. Connect it again with Connect WhatsApp Business.')
    }
    if (number.connection_status === 'connected') throw new ConflictException('This number is already registered and connected.')
    const blockedUntil = number.registration_blocked_until ? new Date(number.registration_blocked_until) : null
    if (blockedUntil && blockedUntil > new Date()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Meta has locked registration of this number after too many attempts, until ${DATE_TIME.format(blockedUntil)}. Try again after that; each attempt before then extends Meta's lock.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    // A run in progress may already be past the registration step and would never read the PIN, so the PIN is
    // not stored then: the admin enters it once the run has finished. A waiting or delayed run reads it.
    if (await this.queues.isRunning('whatsapp-number-verification', { companyId, numberId })) {
      throw new ConflictException(
        'LeaseGuard is still verifying this number with Meta. Enter the PIN again once the checks below have finished; it was not stored.',
      )
    }
    try {
      await this.pins().put(companyId, numberId, pin)
    } catch {
      this.logger.error(`Could not hand the registration PIN of number ${numberId} to the worker`)
      throw new HttpException('Background processing is not available; try again shortly', HttpStatus.SERVICE_UNAVAILABLE)
    }
    return this.enqueue(companyId, numberId, 'LeaseGuard is registering the number with Meta. The PIN is used once and never stored.')
  }

  /** Disconnects a number: it can no longer send or receive, and its stored token is removed when unused. */
  async disconnect(db: DbClient, companyId: EntityId, numberId: EntityId): Promise<DisconnectResult> {
    const { data, error } = await db.rpc('disconnect_whatsapp_number', { p_company_id: companyId, p_number_id: numberId })
    if (error) throw httpErrorFromDatabase(error, 'Disconnect a WhatsApp number')
    const row = data?.[0]
    if (!row || row.outcome !== 'disconnected') throw new NotFoundException('The WhatsApp number was not found')
    this.logger.log(`WhatsApp number ${numberId} of company ${companyId} disconnected (token removed: ${row.token_removed})`)
    return {
      numberId,
      status: 'disconnected',
      tokenRemoved: row.token_removed,
      message: row.token_removed
        ? 'The number is disconnected and LeaseGuard deleted its stored access token. To remove LeaseGuard in Meta as well, open Meta Business Settings → Integrations → Connected apps.'
        : "The number is disconnected. Its access token was not deleted: another number of this workspace still uses it, or it is held in the LeaseGuard worker's environment rather than in the vault (ask Nexus Solution to remove it there).",
    }
  }

  /** The templates Meta holds for the company's accounts, as last synced; by name and language. */
  async listTemplates(db: DbClient, companyId: EntityId): Promise<WhatsAppMessageTemplate[]> {
    const { data, error } = await db
      .from('whatsapp_message_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('company_id', companyId)
      .order('name')
      .order('language')
      .order('id')
    if (error) throw httpErrorFromDatabase(error, 'List WhatsApp message templates')
    return (data ?? []).map((row) => ({
      id: row.id,
      businessAccountId: row.business_account_id,
      metaTemplateId: row.meta_template_id,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      ...(row.rejected_reason ? { rejectedReason: row.rejected_reason } : {}),
      syncedAt: row.synced_at,
      ...(row.status_updated_at ? { statusUpdatedAt: row.status_updated_at } : {}),
    }))
  }

  /**
   * After Embedded Signup: starts verifying the company's number with that Meta phone number id. Never throws:
   * the signup succeeded either way, and the admin can click Verify again. Returns whether it was queued.
   */
  async verifyAfterSignup(db: DbClient, companyId: EntityId, phoneNumberId: string): Promise<boolean> {
    try {
      const { data, error } = await db
        .from('whatsapp_phone_numbers')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone_number_id', phoneNumberId)
        .maybeSingle()
      if (error || !data) throw new Error(error?.message ?? 'number not found')
      await this.enqueue(companyId, data.id, '')
      return true
    } catch (error) {
      this.logger.warn(`Verification of number ${phoneNumberId} (company ${companyId}) was not queued: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private async enqueue(companyId: EntityId, numberId: EntityId, message: string): Promise<VerificationRequest> {
    const { outcome } = await this.queues.enqueueOrRetry('whatsapp-number-verification', { companyId, numberId })
    return { numberId, status: RUNNING.has(outcome) ? 'already_running' : 'queued', message }
  }

  private async number(db: DbClient, companyId: EntityId, numberId: EntityId) {
    const { data, error } = await db
      .from('whatsapp_phone_numbers')
      .select('id, connection_status, registration_blocked_until')
      .eq('company_id', companyId)
      .eq('id', numberId)
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Load a WhatsApp number')
    if (!data) throw new NotFoundException('The WhatsApp number was not found')
    return data
  }

  private pins(): RegistrationPins {
    this.pinStore ??= new RegistrationPins(this.queues.redis(), this.env.QUEUE_PREFIX)
    return this.pinStore
  }
}

const RUNNING: ReadonlySet<EnqueueOutcome> = new Set(['already_queued'])
