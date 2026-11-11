import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type EntityId,
  whatsAppSetup,
  type WhatsAppActivation,
  type WhatsAppSetup,
  type WhatsAppSetupRow,
  type WhatsAppTestMessage,
  type WhatsAppTestMessageStatus,
} from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import type { CompanyContext } from '../../common/request-context'
import type { Tables } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'

/** What a company admin asks to send. */
export interface TestMessageRequest {
  numberId: EntityId
  templateId: EntityId
  /** E.164. */
  to: string
}

const TEST_MESSAGE_COLUMNS =
  'id, number_id, template_name, template_language, to_number, status, failure_reason, may_have_been_sent, requested_by_user_id, created_at, sent_at, delivered_at, read_at, failed_at'
type TestMessageRow = Pick<
  Tables<'whatsapp_test_messages'>,
  | 'id'
  | 'number_id'
  | 'template_name'
  | 'template_language'
  | 'to_number'
  | 'status'
  | 'failure_reason'
  | 'may_have_been_sent'
  | 'requested_by_user_id'
  | 'created_at'
  | 'sent_at'
  | 'delivered_at'
  | 'read_at'
  | 'failed_at'
>

/**
 * The company's WhatsApp setup: the ten steps as the database computed them from verified facts
 * (whatsapp_setup_status), the activation, and company admins' test messages. Read and written with the caller's
 * client: the database functions re-check membership and the admin role, and the activation guard refuses activating
 * while a required step is not verified, whoever asks.
 */
@Injectable()
export class WhatsAppSetupService {
  private readonly logger = new Logger(WhatsAppSetupService.name)

  constructor(private readonly queues: QueueProducer) {}

  async status(db: DbClient, company: CompanyContext): Promise<WhatsAppSetup> {
    const isAdmin = company.role === 'company_admin'
    const [steps, activation, latest] = await Promise.all([
      db.rpc('whatsapp_setup_status', { p_company_id: company.companyId }),
      this.activation(db, company.companyId),
      isAdmin
        ? db
            .from('whatsapp_test_messages')
            .select(TEST_MESSAGE_COLUMNS)
            .eq('company_id', company.companyId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (steps.error) throw httpErrorFromDatabase(steps.error, 'Read the WhatsApp setup')
    if (latest.error) throw httpErrorFromDatabase(latest.error, 'Read the latest WhatsApp test message')
    const rows: WhatsAppSetupRow[] = (steps.data ?? []).map((row) => ({
      step: row.step as WhatsAppSetupRow['step'],
      required: row.required,
      state: row.state as WhatsAppSetupRow['state'],
    }))
    return whatsAppSetup(rows, activation, latest.data ? toTestMessage(latest.data) : undefined)
  }

  /** Records the request (the database checks admin, number, template, tenant and rate) and queues the send. */
  async sendTestMessage(db: DbClient, companyId: EntityId, request: TestMessageRequest): Promise<WhatsAppTestMessage> {
    const { data, error } = await db.rpc('request_whatsapp_test_message', {
      p_company_id: companyId,
      p_number_id: request.numberId,
      p_template_id: request.templateId,
      p_to_number: request.to,
    })
    if (error) throw httpErrorFromDatabase(error, 'Request a WhatsApp test message')
    const row = data?.[0]
    if (!row) throw new NotFoundException('The WhatsApp number was not found')
    if (row.outcome !== 'created' || !row.test_message_id) throw refusal(row.outcome)
    const testMessageId = row.test_message_id

    try {
      await this.queues.enqueue('whatsapp-test-message', { companyId, testMessageId })
    } catch (enqueueError) {
      const abandoned = await db.rpc('abandon_whatsapp_test_message', {
        p_company_id: companyId,
        p_test_message_id: testMessageId,
        p_reason: 'LeaseGuard could not start sending it (background processing was unavailable). Send another test message.',
      })
      if (abandoned.error) this.logger.warn(`Test message ${testMessageId} could not be marked failed: ${abandoned.error.message}`)
      throw enqueueError
    }

    const stored = await db.from('whatsapp_test_messages').select(TEST_MESSAGE_COLUMNS).eq('company_id', companyId).eq('id', testMessageId).maybeSingle()
    if (stored.error) throw httpErrorFromDatabase(stored.error, 'Read the WhatsApp test message')
    if (!stored.data) throw new NotFoundException('The WhatsApp test message was not found')
    return toTestMessage(stored.data)
  }

  async activate(db: DbClient, companyId: EntityId): Promise<WhatsAppActivation> {
    const { data, error } = await db.rpc('activate_company_whatsapp', { p_company_id: companyId })
    if (error) throw httpErrorFromDatabase(error, 'Activate WhatsApp')
    if (data === 'not_ready') {
      throw new ConflictException('WhatsApp cannot be activated yet: finish every required setup step first. Each step shows what to do next.')
    }
    return this.activation(db, companyId)
  }

  async deactivate(db: DbClient, companyId: EntityId): Promise<WhatsAppActivation> {
    const { error } = await db.rpc('deactivate_company_whatsapp', { p_company_id: companyId })
    if (error) throw httpErrorFromDatabase(error, 'Deactivate WhatsApp')
    return this.activation(db, companyId)
  }

  private async activation(db: DbClient, companyId: EntityId): Promise<WhatsAppActivation> {
    const { data, error } = await db.from('companies').select('whatsapp_activated_at, whatsapp_activated_by_user_id').eq('id', companyId).maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Read the WhatsApp activation')
    if (!data?.whatsapp_activated_at) return { active: false }
    return {
      active: true,
      activatedAt: data.whatsapp_activated_at,
      ...(data.whatsapp_activated_by_user_id ? { activatedByUserId: data.whatsapp_activated_by_user_id } : {}),
    }
  }
}

function refusal(outcome: string): HttpException {
  switch (outcome) {
    case 'number_not_found':
      return new NotFoundException('The WhatsApp number was not found')
    case 'template_not_found':
      return new NotFoundException("The message template was not found in this number's WhatsApp Business Account")
    case 'number_not_connected':
      return new ConflictException('This number is not connected. Test messages are sent only from a connected number.')
    case 'template_not_approved':
      return new UnprocessableEntityException('Meta has not approved this template. Choose an approved template.')
    case 'tenant':
      return new UnprocessableEntityException(
        'This is a tenant’s WhatsApp number. Tenants only receive approved statement and payment messages; use your own number.',
      )
    case 'rate_limited':
      return new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message: 'At most 10 test messages per hour. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    default:
      return new UnprocessableEntityException('The test message could not be sent')
  }
}

function toTestMessage(row: TestMessageRow): WhatsAppTestMessage {
  return {
    id: row.id,
    numberId: row.number_id,
    templateName: row.template_name,
    templateLanguage: row.template_language,
    toNumber: row.to_number,
    status: row.status as WhatsAppTestMessageStatus,
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    mayHaveBeenSent: row.may_have_been_sent,
    ...(row.requested_by_user_id ? { requestedByUserId: row.requested_by_user_id } : {}),
    createdAt: row.created_at,
    ...(row.sent_at ? { sentAt: row.sent_at } : {}),
    ...(row.delivered_at ? { deliveredAt: row.delivered_at } : {}),
    ...(row.read_at ? { readAt: row.read_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
  }
}
