import type { CommunicationSortField } from '@leaseguard/api-client'
import type { Channel, Communication, DeliveryStatus, EntityId, MessageApproval, MessageType, RecipientType } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { CommunicationSortField }

/** Sort fields accepted by `GET /api/v1/communications` (generated from the backend's OpenAPI document). */
export const COMMUNICATION_SORT_FIELDS = ['createdAt', 'sentAt', 'status'] as const satisfies readonly CommunicationSortField[]

/** Filters accepted by `GET /api/v1/communications`, each a single optional value. */
export interface CommunicationListParams extends ListParams<CommunicationSortField> {
  status?: DeliveryStatus
  messageType?: MessageType
  recipientType?: RecipientType
  channel?: Channel
  tenantId?: EntityId
  propertyId?: EntityId
}

/** An open approval request with the message it is about (`GET /api/v1/communications/approvals`). */
export interface PendingApproval {
  approval: MessageApproval
  communication: Communication
}

/** The recorded decision and the message's new state. */
export interface ApprovalDecisionResult {
  approval: MessageApproval
  communication: Communication
}

/** Paging for the approval queue (oldest request first). */
export interface ApprovalQueueParams {
  page: number
  pageSize: number
}

/**
 * Where communications come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface CommunicationSource {
  list(companyId: EntityId, params: CommunicationListParams): Promise<Page<Communication>>
  get(companyId: EntityId, id: EntityId): Promise<Communication | null>
  /** Messages awaiting a property manager's approval, oldest request first. Readable by every member. */
  listPendingApprovals(companyId: EntityId, params: ApprovalQueueParams): Promise<Page<PendingApproval>>
  /**
   * Company writers: approve and queue for delivery. Rejects with a 422 ApiError whose `messages` list every
   * reason delivery would refuse the message (the deliverability blockers), 409 when already decided.
   */
  approve(companyId: EntityId, communicationId: EntityId, note?: string): Promise<ApprovalDecisionResult>
  /** Company writers: reject with a reason (required); the message is never sent. */
  reject(companyId: EntityId, communicationId: EntityId, reason: string): Promise<ApprovalDecisionResult>
}
