import { Injectable } from '@nestjs/common'
import type { Communication, EntityId } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toCommunicationWithApprovals, toPendingApproval, type PendingApproval } from './communications.mapper'
import {
  APPROVAL_QUEUE_SORT_COLUMNS,
  COMMUNICATION_SORT_COLUMNS,
  type ApprovalQueueQuery,
  type CommunicationListQuery,
} from './communications.schemas'

const SEARCH_COLUMNS = ['body', 'counterparty_number'] as const

/** Communication columns plus each approval request, so the governing `approvalId` can be derived. */
export const COMMUNICATION_SELECT =
  '*, approvals:message_approvals!message_approvals_communication_fk(id, decision, requested_at)' as const

/**
 * Reads the message log and the approval queue of one company. Every query runs through the caller's
 * RLS-bound client and also filters by company explicitly.
 */
@Injectable()
export class CommunicationsService {
  async list(db: DbClient, companyId: EntityId, query: CommunicationListQuery): Promise<Page<Communication>> {
    const filtered = () => {
      let request = db.from('communications').select(COMMUNICATION_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.messageType) request = request.eq('message_type', query.messageType)
      if (query.recipientType) request = request.eq('recipient_type', query.recipientType)
      if (query.channel) request = request.eq('channel', query.channel)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = COMMUNICATION_SORT_COLUMNS[query.sort ?? 'createdAt']
    // Only sent_at can be null; unsent messages go last. created_at and status are NOT NULL, and adding
    // NULLS LAST to them would stop the (company_id[, tenant_id], created_at desc) indexes ordering the rows.
    const nulls = sortColumn === 'sent_at' ? { nullsFirst: false } : {}
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc', ...nulls })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List communications')
      throw httpErrorFromDatabase(error, 'List communications')
    }
    return toPage(data, count, query, toCommunicationWithApprovals)
  }

  async get(db: DbClient, companyId: EntityId, communicationId: EntityId): Promise<Communication> {
    const row = unwrapDatabase(
      await db
        .from('communications')
        .select(COMMUNICATION_SELECT)
        .eq('company_id', companyId)
        .eq('id', communicationId)
        .maybeSingle(),
      'Get communication',
    )
    return toCommunicationWithApprovals(row)
  }

  /** Open approval requests (decision `pending`) with the message each one is about. */
  async listPendingApprovals(db: DbClient, companyId: EntityId, query: ApprovalQueueQuery): Promise<Page<PendingApproval>> {
    const filtered = () =>
      db
        .from('message_approvals')
        .select('*, communication:communications!message_approvals_communication_fk(*)', { count: 'exact' })
        .eq('company_id', companyId)
        .eq('decision', 'pending')

    const sortColumn = APPROVAL_QUEUE_SORT_COLUMNS[query.sort ?? 'requestedAt']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List pending approvals')
      throw httpErrorFromDatabase(error, 'List pending approvals')
    }
    // The composite foreign key guarantees the message exists and both tables share the same
    // membership policy, so a missing embed never happens in practice; it is skipped, not invented.
    const page = toPage(data, count, query, toPendingApproval)
    return { ...page, items: page.items.filter((item): item is PendingApproval => item !== undefined) }
  }
}
