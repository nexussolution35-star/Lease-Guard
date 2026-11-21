import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  TEMPLATED_MESSAGE_TYPES,
  messageTypeAudience,
  messageTypeTemplateState,
  messageTypeVariableNames,
  templateMappingProblems,
  templatePlaceholders,
  type EntityId,
  type MessageTemplateSettings,
  type MessageTypeTemplate,
  type MessageTypeTemplateMapping,
  type TemplatedMessageType,
  type WhatsAppTemplateHeaderFormat,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import type { Tables } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'
import type { ChooseMessageTemplateBody } from './message-templates.schemas'

type MappingRow = Pick<Tables<'message_type_templates'>, 'message_type' | 'message_template_id' | 'mapped_at' | 'mapped_by_user_id'> & {
  template: Pick<
    Tables<'message_templates'>,
    'id' | 'meta_template_name' | 'language' | 'category' | 'body' | 'variables' | 'approval_status' | 'supports_document_attachment'
  > | null
}
type SyncedRow = Pick<Tables<'whatsapp_message_templates'>, 'id' | 'name' | 'language' | 'status' | 'rejected_reason' | 'body'>

const MAPPING_SELECT =
  'message_type, message_template_id, mapped_at, mapped_by_user_id, ' +
  'template:message_templates!message_type_templates_template_fk(id, meta_template_name, language, category, body, variables, approval_status, supports_document_attachment)'

/**
 * The database's answers to choosing a template, for people: P0001 (Meta has not approved it, a tenant type's
 * template is not Utility, banking details or a forbidden tenant topic, the template already sends another type) keeps
 * the default 422 with the database's words; P0002 (a template of another company) is 404; 22023 (a type sent without
 * a template) is 400; 42501 (not a company admin) keeps the default 403.
 */
const CHOOSE_ERRORS: DatabaseErrorOverrides = {
  P0002: (error) => new NotFoundException(error.message),
  '22023': (error) => new BadRequestException(error.message),
}

/**
 * Settings → Message templates (ticket SG-01): every templated message type with the Meta template that sends it, a
 * company admin choosing one, and syncing the templates from Meta again.
 *
 * Reads go through the caller's RLS-bound client and filter by company. Choosing calls set_message_type_template,
 * which checks the role and every mapping rule and writes the audit entry; the API checks the same rules first
 * (@leaseguard/domain templateMappingProblems) so the admin reads every reason at once. The API never calls Meta: a
 * sync is queued for the worker, which holds the business tokens.
 */
@Injectable()
export class MessageTemplatesService {
  constructor(private readonly queues: QueueProducer) {}

  async settings(db: DbClient, companyId: EntityId): Promise<MessageTemplateSettings> {
    const [mappingsResult, syncedResult, connectedResult] = await Promise.all([
      db.from('message_type_templates').select(MAPPING_SELECT).eq('company_id', companyId),
      db
        .from('whatsapp_message_templates')
        .select('id, name, language, status, rejected_reason, body')
        .eq('company_id', companyId)
        .order('synced_at', { ascending: false })
        .order('id'),
      db
        .from('whatsapp_phone_numbers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('connection_status', 'connected'),
    ])
    if (mappingsResult.error) throw httpErrorFromDatabase(mappingsResult.error, 'List message template mappings')
    if (syncedResult.error) throw httpErrorFromDatabase(syncedResult.error, 'List WhatsApp message templates')
    if (connectedResult.error) throw httpErrorFromDatabase(connectedResult.error, 'Count connected WhatsApp numbers')

    const mappings = (mappingsResult.data ?? []) as unknown as MappingRow[]
    const synced = (syncedResult.data ?? []) as SyncedRow[]
    const names = await memberNames(db, mappings.flatMap((m) => (m.mapped_by_user_id ? [m.mapped_by_user_id] : [])))

    const types = TEMPLATED_MESSAGE_TYPES.map((messageType): MessageTypeTemplate => {
      const row = mappings.find((m) => m.message_type === messageType)
      const mapping = row?.template ? toMapping(row, row.template, synced, names) : undefined
      return {
        messageType,
        audience: messageTypeAudience(messageType),
        ...(mapping ? { mapping } : {}),
        sendable: messageTypeTemplateState(mapping).sendable,
      }
    })
    return { whatsappConnected: (connectedResult.count ?? 0) > 0, types }
  }

  /**
   * A company admin chooses synced Meta template `whatsappTemplateId` for `messageType`. 404 for a template that is not
   * the company's; 422 with every reason when it cannot serve the type; 403 for anyone but a company admin. Audited.
   */
  async choose(db: DbClient, companyId: EntityId, messageType: TemplatedMessageType, body: ChooseMessageTemplateBody): Promise<MessageTypeTemplate> {
    const { data: candidate, error } = await db
      .from('whatsapp_message_templates')
      .select('id, name, language, category, status, body, header_format')
      .eq('company_id', companyId)
      .eq('id', body.whatsappTemplateId)
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Load a WhatsApp message template')
    if (!candidate) throw new NotFoundException('The WhatsApp template is not in this workspace')

    const problems = templateMappingProblems(messageType, {
      name: candidate.name,
      language: candidate.language,
      category: candidate.category,
      status: candidate.status,
      ...(candidate.body ? { body: candidate.body } : {}),
      ...(candidate.header_format ? { headerFormat: candidate.header_format as WhatsAppTemplateHeaderFormat } : {}),
    })
    if (problems.length > 0) throw new UnprocessableEntityException(problems)

    const placeholders = templatePlaceholders(candidate.body ?? '')
    const variables = messageTypeVariableNames(messageType, placeholders.length)
    unwrapDatabase(
      await db.rpc('set_message_type_template', {
        p_company_id: companyId,
        p_message_type: messageType,
        p_whatsapp_template_id: candidate.id,
        p_variables: variables,
      }),
      'Choose a message template',
      CHOOSE_ERRORS,
    )
    const settings = await this.settings(db, companyId)
    const chosen = settings.types.find((t) => t.messageType === messageType)
    if (!chosen) throw new NotFoundException('The message type was not found')
    return chosen
  }

  /**
   * Queues a template sync of each connected number's WhatsApp Business Account (one number per account). 409 while the
   * company has no connected number; 503 when background processing is unavailable.
   */
  async sync(db: DbClient, companyId: EntityId): Promise<{ queued: number; message: string }> {
    const { data, error } = await db
      .from('whatsapp_phone_numbers')
      .select('id, business_account_id')
      .eq('company_id', companyId)
      .eq('connection_status', 'connected')
      .order('created_at')
      .order('id')
    if (error) throw httpErrorFromDatabase(error, 'List connected WhatsApp numbers')
    const perAccount = new Map<string, EntityId>()
    for (const number of data ?? []) if (!perAccount.has(number.business_account_id)) perAccount.set(number.business_account_id, number.id)
    if (perAccount.size === 0) {
      throw new ConflictException('Connect a WhatsApp number first: templates are synced from its WhatsApp Business Account.')
    }
    for (const numberId of perAccount.values()) await this.queues.enqueueOrRetry('whatsapp-template-sync', { companyId, numberId })
    return {
      queued: perAccount.size,
      message: 'LeaseGuard is syncing the templates from Meta. Statuses and text update here in a few moments.',
    }
  }
}

function toMapping(
  row: MappingRow,
  template: NonNullable<MappingRow['template']>,
  synced: readonly SyncedRow[],
  names: ReadonlyMap<EntityId, string>,
): MessageTypeTemplateMapping {
  // Meta's template with the same name and language (the newest sync first), as the database reflects its status.
  const meta = synced.find((s) => s.name === template.meta_template_name && s.language === template.language)
  const mappedByName = row.mapped_by_user_id ? names.get(row.mapped_by_user_id) : undefined
  return {
    templateId: template.id,
    ...(meta ? { whatsappTemplateId: meta.id, metaStatus: meta.status } : {}),
    ...(meta?.rejected_reason ? { rejectedReason: meta.rejected_reason } : {}),
    metaTemplateName: template.meta_template_name,
    language: template.language,
    category: template.category,
    body: template.body,
    variables: template.variables,
    approvalStatus: template.approval_status,
    supportsDocumentAttachment: template.supports_document_attachment,
    metaBodyChanged: meta?.body != null && meta.body !== template.body,
    mappedAt: row.mapped_at,
    ...(row.mapped_by_user_id ? { mappedByUserId: row.mapped_by_user_id } : {}),
    ...(mappedByName ? { mappedByName } : {}),
  }
}

/** Names of colleagues by user id (profiles are readable by members of a shared company). */
async function memberNames(db: DbClient, userIds: readonly EntityId[]): Promise<ReadonlyMap<EntityId, string>> {
  if (userIds.length === 0) return new Map()
  const rows = unwrapDatabase(await db.from('profiles').select('id, full_name').in('id', [...new Set(userIds)]), 'Load member names')
  return new Map(rows.flatMap((row) => (row.full_name ? [[row.id, row.full_name] as const] : [])))
}
