import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { EntityId, WhatsAppConnectionStatus } from '@leaseguard/domain'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { RegistrationPins } from '../../infrastructure/whatsapp/registration-pins'
import { type MetaMessageTemplate, type MetaPhoneNumber, WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { WorkerQueues } from '../queues/worker-queues'
import { Clock } from '../shared/clock'
import { unwrap, WorkerDatabaseError } from '../shared/db'
import { type NumberToVerify, type StepRecord, type VerificationOutcome, type VerificationStore, verifyNumber } from './number-verification'

const clip = (value: string | undefined, max: number): string | null => (value ? value.slice(0, max) : null)

/**
 * The verification store on the database, with the service role: every query names the job's company, and
 * the status is decided by finish_whatsapp_number_verification from the recorded steps
 * (20261110100700_whatsapp_number_verification).
 */
export class DatabaseVerificationStore implements VerificationStore {
  constructor(
    private readonly db: DbClient,
    private readonly now: () => Date,
  ) {}

  async load(companyId: EntityId, numberId: EntityId): Promise<NumberToVerify | null> {
    const number = await this.db
      .from('whatsapp_phone_numbers')
      .select('connection_status, registration_blocked_until, phone_number_id')
      .eq('company_id', companyId)
      .eq('id', numberId)
      .maybeSingle()
    if (number.error) throw new WorkerDatabaseError('Load the WhatsApp number', number.error)
    if (!number.data) return null
    // The Embedded Signup that brought the number says whether it is a WhatsApp Business app number.
    const session = await this.db
      .from('whatsapp_onboarding_sessions')
      .select('is_on_business_app')
      .eq('company_id', companyId)
      .eq('phone_number_id', number.data.phone_number_id)
      .in('status', ['exchanged', 'completed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (session.error) throw new WorkerDatabaseError('Load the WhatsApp signup of the number', session.error)
    return {
      connectionStatus: number.data.connection_status,
      registrationBlockedUntil: number.data.registration_blocked_until ? new Date(number.data.registration_blocked_until) : null,
      onBusinessApp: session.data?.is_on_business_app === true,
    }
  }

  async recordSteps(companyId: EntityId, numberId: EntityId, steps: readonly StepRecord[]): Promise<void> {
    const checkedAt = this.now().toISOString()
    unwrap(
      await this.db.from('whatsapp_number_verification_steps').upsert(
        steps.map((s) => ({
          company_id: companyId,
          number_id: numberId,
          step: s.step,
          status: s.status,
          message: clip(s.message, 1000),
          recovery: clip(s.recovery, 1000),
          meta_error_code: clip(s.metaErrorCode, 40),
          checked_at: checkedAt,
        })),
        { onConflict: 'number_id,step' },
      ),
      'Record WhatsApp verification steps',
      null,
    )
  }

  async recordMetaView(companyId: EntityId, numberId: EntityId, meta: MetaPhoneNumber): Promise<void> {
    unwrap(
      await this.db
        .from('whatsapp_phone_numbers')
        .update({
          ...(meta.displayPhoneNumber ? { display_number: meta.displayPhoneNumber.slice(0, 40) } : {}),
          verified_name: clip(meta.verifiedName, 200),
          quality_rating: clip(meta.qualityRating, 40),
          code_verification_status: clip(meta.codeVerificationStatus, 40),
          name_status: clip(meta.nameStatus, 60),
          meta_status: clip(meta.status, 40),
        })
        .eq('company_id', companyId)
        .eq('id', numberId),
      "Record Meta's view of the WhatsApp number",
      null,
    )
    if (meta.verifiedName) {
      // A number from Embedded Signup has no display name yet: Meta's verified name becomes it.
      unwrap(
        await this.db
          .from('whatsapp_phone_numbers')
          .update({ display_name: meta.verifiedName.slice(0, 200) })
          .eq('company_id', companyId)
          .eq('id', numberId)
          .eq('display_name', ''),
        'Name the WhatsApp number',
        null,
      )
    }
  }

  async blockRegistration(companyId: EntityId, numberId: EntityId, until: Date): Promise<void> {
    unwrap(
      await this.db
        .from('whatsapp_phone_numbers')
        .update({ registration_blocked_until: until.toISOString() })
        .eq('company_id', companyId)
        .eq('id', numberId),
      'Record the registration lock',
      null,
    )
  }

  async syncTemplates(companyId: EntityId, businessAccountId: string, templates: readonly MetaMessageTemplate[]): Promise<number> {
    const payload = templates.map((t) => ({
      id: t.id,
      name: t.name.slice(0, 512),
      language: t.language.slice(0, 20),
      category: t.category.slice(0, 40),
      status: t.status.slice(0, 40),
      rejected_reason: t.rejectedReason ?? null,
    }))
    const count = unwrap(
      await this.db.rpc('sync_whatsapp_message_templates', { p_company_id: companyId, p_business_account_id: businessAccountId, p_templates: payload }),
      'Sync the WhatsApp message templates',
      0,
    )
    return count
  }

  async finish(companyId: EntityId, numberId: EntityId): Promise<WhatsAppConnectionStatus> {
    const status = unwrap(
      await this.db.rpc('finish_whatsapp_number_verification', { p_company_id: companyId, p_number_id: numberId }),
      'Finish the WhatsApp number verification',
      null,
    )
    if (!status) throw new Error('finish_whatsapp_number_verification returned no status')
    return status
  }
}

/**
 * Queue `whatsapp-number-verification`: verifies one business number with Meta (number-verification.ts) and
 * connects it only when every step passed. The registration PIN, when the admin entered one, is taken from its
 * single-use Redis key; it never appears in the payload, the job history or a log.
 */
@Injectable()
export class WhatsAppNumberVerificationProcessor implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppNumberVerificationProcessor.name)
  private readonly pins: RegistrationPins

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly channels: WhatsAppChannels,
    private readonly clock: Clock,
    queues: WorkerQueues,
    @Inject(WORKER_ENV) env: WorkerEnv,
  ) {
    this.pins = new RegistrationPins(queues.connection, env.QUEUE_PREFIX)
  }

  onModuleInit(): void {
    this.runtime.start('whatsapp-number-verification', (payload, attempt) => this.process(payload, attempt), { concurrency: 2 })
  }

  async process({ companyId, numberId }: JobPayloads['whatsapp-number-verification'], attempt: JobAttempt): Promise<VerificationOutcome> {
    const now = () => this.clock.now()
    const result = await verifyNumber(
      { companyId, numberId },
      { finalAttempt: isFinalAttempt(attempt) },
      { channels: this.channels, store: new DatabaseVerificationStore(this.clients.get(), now), pins: this.pins, now },
    )
    if (result.outcome === 'skipped') {
      this.logger.log({ companyId, numberId, reason: result.reason }, 'WhatsApp number not verified')
    } else {
      const failed = result.steps.find((s) => s.status === 'failed')
      this.logger.log(
        { companyId, numberId, status: result.status, failedStep: failed?.step, metaErrorCode: failed?.metaErrorCode },
        'WhatsApp number verified with Meta',
      )
    }
    return result
  }
}
