import { Logger } from '@nestjs/common'
import type { Communication, MessageApproval, StoredFile } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'
import { currentApproval } from '../../messaging/governing-approval'

export type CommunicationRow = Tables<'communications'>
export type MessageApprovalRow = Tables<'message_approvals'>

/** The approval columns embedded with a communication to derive `approvalId`. */
export type ApprovalSummaryRow = Pick<MessageApprovalRow, 'id' | 'decision' | 'requested_at'>

/** A communication with its approval requests embedded (`approvals:message_approvals(...)`). */
export type CommunicationWithApprovalsRow = CommunicationRow & { approvals: ApprovalSummaryRow[] }

/** A pending approval with its communication embedded (`communication:communications(...)`). */
export type PendingApprovalRow = MessageApprovalRow & { communication: CommunicationRow | null }

/** A pending approval request together with the message awaiting the decision. */
export interface PendingApproval {
  approval: MessageApproval
  communication: Communication
}

/** Result of approving or rejecting a message: the recorded decision and the message's new state. */
export interface ApprovalDecisionResult {
  approval: MessageApproval
  communication: Communication
}

const ATTACHMENT_MIME_TYPES: readonly StoredFile['mimeType'][] = ['application/pdf', 'image/png', 'image/jpeg']
const logger = new Logger('CommunicationsMapper')

function isAttachmentMimeType(value: string): value is StoredFile['mimeType'] {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
}

/**
 * The attachment columns as a `StoredFile`, or undefined when there is none. The database allows an
 * attachment without size or digest; such a row cannot be described as a complete `StoredFile`, so it
 * is reported in the log and left out rather than filled with invented values.
 */
function toAttachment(row: CommunicationRow): StoredFile | undefined {
  if (row.attachment_storage_path === null || row.attachment_file_name === null) return undefined
  const mimeType = row.attachment_mime_type
  if (
    mimeType === null ||
    !isAttachmentMimeType(mimeType) ||
    row.attachment_size_bytes === null ||
    row.attachment_sha256 === null
  ) {
    logger.warn(`Communication ${row.id} has an incomplete attachment record; attachment omitted`)
    return undefined
  }
  return {
    fileName: row.attachment_file_name,
    storagePath: row.attachment_storage_path,
    mimeType,
    sizeBytes: row.attachment_size_bytes,
    sha256: row.attachment_sha256,
  }
}

/** Database row → domain `Communication`. Nullable columns become absent optional fields. */
export function toCommunication(row: CommunicationRow, approvals: readonly ApprovalSummaryRow[] = []): Communication {
  const attachment = toAttachment(row)
  const approval = currentApproval(approvals)
  return {
    id: row.id,
    companyId: row.company_id,
    channel: row.channel,
    direction: row.direction,
    messageType: row.message_type,
    recipientType: row.recipient_type,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}),
    ...(row.property_id ? { propertyId: row.property_id } : {}),
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.statement_id ? { statementId: row.statement_id } : {}),
    ...(row.arrangement_id ? { arrangementId: row.arrangement_id } : {}),
    ...(row.template_id ? { templateId: row.template_id } : {}),
    ...(row.counterparty_number ? { counterpartyNumber: row.counterparty_number } : {}),
    ...(row.contact_id ? { contactId: row.contact_id } : {}),
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.received_at ? { receivedAt: row.received_at } : {}),
    companyNumber: row.company_number,
    body: row.body,
    ...(attachment ? { attachment } : {}),
    status: row.status,
    ...(approval ? { approvalId: approval.id } : {}),
    ...(row.external_message_id ? { externalMessageId: row.external_message_id } : {}),
    ...(row.created_by_user_id ? { createdByUserId: row.created_by_user_id } : {}),
    ...(row.sent_at ? { sentAt: row.sent_at } : {}),
    ...(row.delivered_at ? { deliveredAt: row.delivered_at } : {}),
    ...(row.read_at ? { readAt: row.read_at } : {}),
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** A communication row with embedded approvals → domain `Communication`. */
export function toCommunicationWithApprovals(row: CommunicationWithApprovalsRow): Communication {
  const { approvals, ...communication } = row
  return toCommunication(communication, approvals)
}

/**
 * A pending approval row with its embedded message → `PendingApproval`. The open request is the
 * approval that governs the message, so it also supplies the message's `approvalId`.
 */
export function toPendingApproval(row: PendingApprovalRow): PendingApproval | undefined {
  const { communication, ...approval } = row
  if (!communication) return undefined
  return { approval: toMessageApproval(approval), communication: toCommunication(communication, [approval]) }
}

/** Database row → domain `MessageApproval`. */
export function toMessageApproval(row: MessageApprovalRow): MessageApproval {
  return {
    id: row.id,
    companyId: row.company_id,
    communicationId: row.communication_id,
    ...(row.requested_by_user_id ? { requestedByUserId: row.requested_by_user_id } : {}),
    requestedAt: row.requested_at,
    decision: row.decision,
    ...(row.decided_by_user_id ? { decidedByUserId: row.decided_by_user_id } : {}),
    ...(row.decided_by_agent_run_id ? { decidedByAgentRunId: row.decided_by_agent_run_id } : {}),
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
