import type { CommunicationSortField } from '@leaseguard/api-client'
import type { Channel, Communication, DeliveryStatus, EntityId, MessageType, RecipientType } from '@leaseguard/domain'

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

/**
 * Where communications come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface CommunicationSource {
  list(companyId: EntityId, params: CommunicationListParams): Promise<Page<Communication>>
  get(companyId: EntityId, id: EntityId): Promise<Communication | null>
}
