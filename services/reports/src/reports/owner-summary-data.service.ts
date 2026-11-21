import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import {
  OWNER_SUMMARY_STATUSES,
  TEMPLATE_APPROVAL_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  WEEKDAYS,
  DELIVERY_STATUSES,
  type DeliveryStatus,
  type EntityId,
  type ISODate,
  type ISODateTime,
  type MessageTypeTemplateMapping,
  type OwnerSummaryStatus,
  type OwnerSummaryRecipient,
  type Weekday,
  type ZAR,
} from '@leaseguard/domain'
import { httpErrorFromDatabase, type DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

import { ReportDataService } from './report-data.service'

const figure = z.coerce.number().refine(Number.isFinite)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().transform((value) => value ?? undefined)

/** A property owner with the properties they own (`reports_owner_summary_owners`). */
export interface SummaryOwner extends OwnerSummaryRecipient {
  userId: EntityId
  name: string
  properties: { propertyId: EntityId; propertyName: string }[]
}

const ownerRow = z
  .object({
    owner_user_id: z.string(),
    owner_name: z.string(),
    owner_status: optional(z.enum(USER_STATUSES)),
    owner_role: optional(z.enum(USER_ROLES)),
    whatsapp_number: optional(z.string()),
    properties: z.array(z.object({ propertyId: z.string(), propertyName: z.string() })),
  })
  .transform(
    (row): SummaryOwner => ({
      userId: row.owner_user_id,
      name: row.owner_name,
      // No profile: the owner cannot be messaged (the rules say why).
      status: row.owner_status ?? 'deactivated',
      // Not a member any more: the owner rules refuse anyone who is not a property owner of the company.
      role: row.owner_role ?? 'read_only',
      ...(row.whatsapp_number ? { whatsappNumber: row.whatsapp_number } : {}),
      properties: row.properties,
    }),
  )

/** The company's owner summary day, its numbers and the template chosen for owner summaries. */
export interface OwnerSummaryChannelRow {
  weekday: Weekday
  whatsappConnected: boolean
  mapping?: MessageTypeTemplateMapping
}

const channelRow = z
  .object({
    owner_summary_weekday: z.enum(WEEKDAYS),
    whatsapp_connected: z.boolean(),
    template_id: optional(z.string()),
    meta_template_name: optional(z.string()),
    language: optional(z.string()),
    category: optional(z.string()),
    body: optional(z.string()),
    variables: optional(z.array(z.string())),
    approval_status: optional(z.enum(TEMPLATE_APPROVAL_STATUSES)),
    supports_document_attachment: optional(z.boolean()),
    mapped_at: optional(z.string()),
    meta_template_id: optional(z.string()),
    meta_status: optional(z.string()),
    meta_rejected_reason: optional(z.string()),
    meta_body: optional(z.string()),
  })
  .transform((row): OwnerSummaryChannelRow => {
    const mapping: MessageTypeTemplateMapping | undefined =
      row.template_id && row.meta_template_name && row.language && row.body !== undefined && row.approval_status && row.mapped_at
        ? {
            templateId: row.template_id,
            ...(row.meta_template_id ? { whatsappTemplateId: row.meta_template_id } : {}),
            metaTemplateName: row.meta_template_name,
            language: row.language,
            category: row.category ?? 'utility',
            body: row.body,
            variables: row.variables ?? [],
            approvalStatus: row.approval_status,
            ...(row.meta_status ? { metaStatus: row.meta_status } : {}),
            ...(row.meta_rejected_reason ? { rejectedReason: row.meta_rejected_reason } : {}),
            supportsDocumentAttachment: row.supports_document_attachment ?? false,
            // As Settings → Message templates reads it: Meta's text differs from the text chosen.
            metaBodyChanged: row.meta_body !== undefined && row.meta_body !== row.body,
            mappedAt: row.mapped_at,
          }
        : undefined
    return { weekday: row.owner_summary_weekday, whatsappConnected: row.whatsapp_connected, ...(mapping ? { mapping } : {}) }
  })

/** One owner's stored summary of a week, its message and the previous week's total (`reports_owner_summaries_stored`). */
export interface StoredOwnerSummary {
  ownerUserId: EntityId
  current?: {
    summaryId: EntityId
    status: OwnerSummaryStatus
    blockers: string[]
    computedAt: ISODateTime
    communicationId?: EntityId
    deliveryStatus?: DeliveryStatus
    failureReason?: string
    sentAt?: ISODateTime
  }
  previous?: { weekStart: ISODate; totalOutstanding: ZAR }
}

const storedRow = z
  .object({
    owner_user_id: z.string(),
    summary_id: optional(z.string()),
    status: optional(z.enum(OWNER_SUMMARY_STATUSES)),
    blockers: optional(z.array(z.string())),
    computed_at: optional(z.string()),
    communication_id: optional(z.string()),
    delivery_status: optional(z.enum(DELIVERY_STATUSES)),
    failure_reason: optional(z.string()),
    sent_at: optional(z.string()),
    previous_week_start: optional(z.string()),
    previous_total_outstanding: optional(figure),
  })
  .transform(
    (row): StoredOwnerSummary => ({
      ownerUserId: row.owner_user_id,
      ...(row.summary_id && row.status && row.computed_at
        ? {
            current: {
              summaryId: row.summary_id,
              status: row.status,
              blockers: row.blockers ?? [],
              computedAt: row.computed_at,
              ...(row.communication_id ? { communicationId: row.communication_id } : {}),
              ...(row.delivery_status ? { deliveryStatus: row.delivery_status } : {}),
              ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
              ...(row.sent_at ? { sentAt: row.sent_at } : {}),
            },
          }
        : {}),
      ...(row.previous_week_start && row.previous_total_outstanding !== undefined
        ? { previous: { weekStart: row.previous_week_start, totalOutstanding: row.previous_total_outstanding } }
        : {}),
    }),
  )

const logger = new Logger('OwnerSummaryData')

/**
 * The company data of the weekly owner summary (ticket R-07), through the reporting functions of
 * supabase/migrations/*_reports_owner_weekly_summaries.sql: with the caller's token on the Reports page (RLS; another
 * company is refused), with the reports worker's service-role client on the weekly run (the company named explicitly).
 */
@Injectable()
export class OwnerSummaryDataService {
  constructor(private readonly data: ReportDataService) {}

  owners(db: DbClient, companyId: EntityId): Promise<SummaryOwner[]> {
    return this.data.rows(db, 'reports_owner_summary_owners', companyId, ownerRow, 'Read the property owners')
  }

  async channel(db: DbClient, companyId: EntityId): Promise<OwnerSummaryChannelRow> {
    const [row] = await this.data.rows(db, 'reports_owner_summary_channel', companyId, channelRow, 'Read the owner summary template')
    if (!row) throw new InternalServerErrorException('An unexpected error occurred')
    return row
  }

  async stored(db: DbClient, companyId: EntityId, weekStart: ISODate): Promise<StoredOwnerSummary[]> {
    const { data, error } = await db.rpc('reports_owner_summaries_stored', { p_company_id: companyId, p_week_start: weekStart })
    if (error) throw httpErrorFromDatabase(error, 'Read the stored owner summaries')
    const parsed = z.array(storedRow).safeParse(data ?? [])
    if (!parsed.success) {
      logger.error(`reports_owner_summaries_stored returned rows of an unexpected shape: ${parsed.error.message}`)
      throw new InternalServerErrorException('An unexpected error occurred')
    }
    return parsed.data
  }
}
