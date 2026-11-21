import { Injectable } from '@nestjs/common'
import {
  APPROVAL_DECISIONS,
  CHANNELS,
  DELIVERY_STATUSES,
  EXTRACTION_FIELD_NAMES,
  MESSAGE_DIRECTIONS,
  MESSAGE_TYPES,
  RECIPIENT_TYPES,
  STATEMENT_SOURCES,
  STATEMENT_STATUSES,
  type CommunicationRecord,
  type EntityId,
  type StatementReviewFieldRecord,
  type StatementUploadRecord,
} from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

import { ReportDataService } from './report-data.service'

/** PostgREST returns numeric columns as JSON numbers (or strings for very large values). */
const figure = z.coerce.number().refine(Number.isFinite)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().transform((value) => value ?? undefined)
/** A jsonb field value: text or a number, or JSON null when the extractor found nothing. */
const fieldValue = z.union([z.string(), z.number()]).nullable()
/** Timestamps arrive as ISO strings with an offset; kept as the database wrote them. */
const timestamp = z.string().min(1)

const statementUploadRow = z
  .object({
    statement_id: z.string(),
    file_name: z.string(),
    statement_number: optional(z.string()),
    property_id: z.string(),
    property_name: z.string(),
    tenant_id: optional(z.string()),
    tenant_name: optional(z.string()),
    unit_id: optional(z.string()),
    unit_number: optional(z.string()),
    source_system: z.enum(STATEMENT_SOURCES),
    status: z.enum(STATEMENT_STATUSES),
    uploaded_at: timestamp,
    uploaded_on: z.string(),
    statement_date: optional(z.string()),
    processing_error: optional(z.string()),
    duplicate_of_statement_id: optional(z.string()),
    extraction_confidence: optional(figure),
  })
  .transform(
    (row): StatementUploadRecord => ({
      statementId: row.statement_id,
      fileName: row.file_name,
      ...(row.statement_number ? { statementNumber: row.statement_number } : {}),
      propertyId: row.property_id,
      propertyName: row.property_name,
      ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
      ...(row.tenant_name ? { tenantName: row.tenant_name } : {}),
      ...(row.unit_id ? { unitId: row.unit_id } : {}),
      ...(row.unit_number ? { unitNumber: row.unit_number } : {}),
      sourceSystem: row.source_system,
      status: row.status,
      uploadedAt: row.uploaded_at,
      uploadedOn: row.uploaded_on,
      ...(row.statement_date ? { statementDate: row.statement_date } : {}),
      ...(row.processing_error ? { processingError: row.processing_error } : {}),
      ...(row.duplicate_of_statement_id ? { duplicateOfStatementId: row.duplicate_of_statement_id } : {}),
      ...(row.extraction_confidence !== undefined ? { extractionConfidence: row.extraction_confidence } : {}),
    }),
  )

const reviewFieldRow = z
  .object({
    statement_id: z.string(),
    name: z.enum(EXTRACTION_FIELD_NAMES),
    value: fieldValue,
    flagged: z.boolean(),
    corrected_value: fieldValue,
    confirmed_at: optional(timestamp),
  })
  .transform(
    (row): StatementReviewFieldRecord => ({
      statementId: row.statement_id,
      name: row.name,
      value: row.value,
      flagged: row.flagged,
      ...(row.corrected_value !== null ? { correctedValue: row.corrected_value } : {}),
      ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
    }),
  )

const communicationRow = z
  .object({
    communication_id: z.string(),
    created_at: timestamp,
    created_on: z.string(),
    channel: z.enum(CHANNELS),
    direction: z.enum(MESSAGE_DIRECTIONS),
    message_type: z.enum(MESSAGE_TYPES),
    recipient_type: z.enum(RECIPIENT_TYPES),
    counterparty_name: optional(z.string()),
    tenant_id: optional(z.string()),
    property_id: optional(z.string()),
    property_name: optional(z.string()),
    statement_id: optional(z.string()),
    arrangement_id: optional(z.string()),
    status: z.enum(DELIVERY_STATUSES),
    failure_reason: optional(z.string()),
    approval_decision: optional(z.enum(APPROVAL_DECISIONS)),
    approval_requested_at: optional(timestamp),
    approval_decided_at: optional(timestamp),
    approval_decided_by_agent: optional(z.boolean()),
  })
  .transform(
    (row): CommunicationRecord => ({
      communicationId: row.communication_id,
      createdAt: row.created_at,
      createdOn: row.created_on,
      channel: row.channel,
      direction: row.direction,
      messageType: row.message_type,
      recipientType: row.recipient_type,
      ...(row.counterparty_name ? { counterpartyName: row.counterparty_name } : {}),
      ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
      ...(row.property_id ? { propertyId: row.property_id } : {}),
      ...(row.property_name ? { propertyName: row.property_name } : {}),
      ...(row.statement_id ? { statementId: row.statement_id } : {}),
      ...(row.arrangement_id ? { arrangementId: row.arrangement_id } : {}),
      status: row.status,
      ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
      ...(row.approval_decision ? { approvalDecision: row.approval_decision } : {}),
      ...(row.approval_requested_at ? { approvalRequestedAt: row.approval_requested_at } : {}),
      ...(row.approval_decided_at ? { approvalDecidedAt: row.approval_decided_at } : {}),
      ...(row.approval_decided_by_agent ? { approvalDecidedByAgent: true } : {}),
    }),
  )

/**
 * The rows the statement processing and communication activity reports read, through the read-only reporting
 * functions of supabase/migrations/*_reports_statements_communications.sql (caller's token, RLS; 42501 → 403 for
 * another company). Rows are validated, so a changed function fails loudly instead of producing wrong figures.
 */
@Injectable()
export class StatementCommunicationReportDataService {
  constructor(private readonly data: ReportDataService) {}

  statementUploads(db: DbClient, companyId: EntityId): Promise<StatementUploadRecord[]> {
    return this.data.rows(db, 'reports_statement_uploads', companyId, statementUploadRow, 'Read the statement uploads')
  }

  reviewFields(db: DbClient, companyId: EntityId): Promise<StatementReviewFieldRecord[]> {
    return this.data.rows(db, 'reports_statement_review_fields', companyId, reviewFieldRow, 'Read the fields waiting for review')
  }

  communications(db: DbClient, companyId: EntityId): Promise<CommunicationRecord[]> {
    return this.data.rows(db, 'reports_communication_activity', companyId, communicationRow, 'Read the communication activity')
  }
}
