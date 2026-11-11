import type { EntityId } from '@leaseguard/domain'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, TablesUpdate } from '../../infrastructure/database/database.types'
import type { ProviderStatusOutcome, ProviderStatusUpdate } from '../../messaging/communication-lifecycle'
import { unwrap, WorkerDatabaseError } from '../shared/db'
import type { TestMessageStore, TestMessageToSend } from './test-message'

// Not the API's DbClient alias (rls-client.factory, a Nest provider): the integration tests import this file.
type DbClient = SupabaseClient<Database>

/**
 * The test message store on the database, with the service role: every query names the job's company, and each
 * transition is a conditional update on the current status, so only one run can claim, release or finish a message.
 */
export class DatabaseTestMessageStore implements TestMessageStore {
  constructor(private readonly db: DbClient) {}

  async load(companyId: EntityId, testMessageId: EntityId): Promise<TestMessageToSend | null> {
    const messageResult = await this.db
      .from('whatsapp_test_messages')
      .select('status, to_number, template_name, template_language, number_id')
      .eq('company_id', companyId)
      .eq('id', testMessageId)
      .maybeSingle()
    if (messageResult.error) throw new WorkerDatabaseError('Load the WhatsApp test message', messageResult.error)
    const message = messageResult.data
    if (!message) return null
    const numberResult = await this.db
      .from('whatsapp_phone_numbers')
      .select('phone_number_id, business_account_id, connection_status')
      .eq('company_id', companyId)
      .eq('id', message.number_id)
      .maybeSingle()
    if (numberResult.error) throw new WorkerDatabaseError('Load the number of the WhatsApp test message', numberResult.error)
    const number = numberResult.data
    if (!number) return null
    const [templates, tenants] = await Promise.all([
      this.db
        .from('whatsapp_message_templates')
        .select('id')
        .eq('company_id', companyId)
        .eq('business_account_id', number.business_account_id)
        .eq('name', message.template_name)
        .eq('language', message.template_language)
        .eq('status', 'APPROVED')
        .limit(1),
      this.db.from('tenants').select('id').eq('company_id', companyId).eq('whatsapp_number', message.to_number).limit(1),
    ])
    return {
      status: message.status as TestMessageToSend['status'],
      toNumber: message.to_number,
      templateName: message.template_name,
      templateLanguage: message.template_language,
      phoneNumberId: number.phone_number_id,
      numberConnected: number.connection_status === 'connected',
      templateApproved: unwrap(templates, 'Load the template of the WhatsApp test message', []).length > 0,
      recipientIsTenant: unwrap(tenants, 'Check the recipient of the WhatsApp test message', []).length > 0,
    }
  }

  async claim(companyId: EntityId, testMessageId: EntityId): Promise<boolean> {
    return (await this.transition(companyId, testMessageId, ['queued'], { status: 'sending' }, 'Claim the WhatsApp test message')) > 0
  }

  async release(companyId: EntityId, testMessageId: EntityId): Promise<void> {
    await this.transition(companyId, testMessageId, ['sending'], { status: 'queued' }, 'Release the WhatsApp test message')
  }

  async recordSent(companyId: EntityId, testMessageId: EntityId, providerMessageId: string): Promise<void> {
    // A status webhook that arrived first was retried by the webhook job (not_found), so 'sending' is the only source.
    await this.transition(
      companyId,
      testMessageId,
      ['sending'],
      { status: 'sent', provider_message_id: providerMessageId, sent_at: new Date().toISOString() },
      'Record the WhatsApp test message as sent',
    )
  }

  async recordFailed(companyId: EntityId, testMessageId: EntityId, reason: string, mayHaveBeenSent: boolean): Promise<void> {
    await this.transition(
      companyId,
      testMessageId,
      ['queued', 'sending'],
      { status: 'failed', failure_reason: reason.slice(0, 2000), may_have_been_sent: mayHaveBeenSent, failed_at: new Date().toISOString() },
      'Record the WhatsApp test message as failed',
    )
  }

  private async transition(
    companyId: EntityId,
    testMessageId: EntityId,
    from: string[],
    changes: TablesUpdate<'whatsapp_test_messages'>,
    operation: string,
  ): Promise<number> {
    const rows = unwrap(
      await this.db
        .from('whatsapp_test_messages')
        .update(changes)
        .eq('company_id', companyId)
        .eq('id', testMessageId)
        .in('status', from)
        .select('id'),
      operation,
      [],
    )
    return rows.length
  }
}

/**
 * Meta's status of a sent test message (record_whatsapp_test_message_status, forward only), for the webhook's statuses
 * that match no communication: test messages are not communications.
 */
export async function recordTestMessageStatus(db: DbClient, update: ProviderStatusUpdate): Promise<ProviderStatusOutcome> {
  const { data, error } = await db.rpc('record_whatsapp_test_message_status', {
    p_company_id: update.companyId,
    p_provider_message_id: update.providerMessageId,
    p_status: update.status,
    p_occurred_at: update.occurredAt,
    ...(update.failureReason ? { p_failure_reason: update.failureReason } : {}),
  })
  if (error) throw new WorkerDatabaseError('Record the status of a WhatsApp test message', error)
  return data as ProviderStatusOutcome
}
