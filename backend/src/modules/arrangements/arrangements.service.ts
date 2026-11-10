import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, PaymentArrangement } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { fetchAllRows } from '../../common/http/fetch-all'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toPaymentArrangement, type ArrangementInstallmentRow, type PaymentArrangementRow } from './arrangements.mapper'
import { ARRANGEMENT_SORT_COLUMNS, type ArrangementListQuery } from './arrangements.schemas'

const SEARCH_COLUMNS = ['notes'] as const

/**
 * Reads payment arrangements and their instalments for one company. These are monitoring records of
 * an agreement between tenant and owner or manager; LeaseGuard never collects or processes payments.
 * Queries run through the caller's RLS-bound client and filter by company explicitly.
 */
@Injectable()
export class ArrangementsService {
  async list(db: DbClient, companyId: EntityId, query: ArrangementListQuery): Promise<Page<PaymentArrangement>> {
    const filtered = () => {
      let request = db.from('payment_arrangements').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.leaseId) request = request.eq('lease_id', query.leaseId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = ARRANGEMENT_SORT_COLUMNS[query.sort ?? 'agreedOn']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List payment arrangements')
      throw httpErrorFromDatabase(error, 'List payment arrangements')
    }

    const items = await this.withInstallments(db, companyId, data ?? [])
    return { items, total: count ?? 0, page: query.page, pageSize: query.pageSize }
  }

  async get(db: DbClient, companyId: EntityId, arrangementId: EntityId): Promise<PaymentArrangement> {
    const row = unwrapDatabase(
      await db.from('payment_arrangements').select('*').eq('company_id', companyId).eq('id', arrangementId).maybeSingle(),
      'Get payment arrangement',
    )
    const [arrangement] = await this.withInstallments(db, companyId, [row])
    if (!arrangement) throw new NotFoundException('The record was not found')
    return arrangement
  }

  /**
   * Loads the instalments of a page of arrangements (not one query per row). A page can hold more
   * instalments than the Data API returns at once, so they are read page by page.
   */
  private async withInstallments(
    db: DbClient,
    companyId: EntityId,
    rows: readonly PaymentArrangementRow[],
  ): Promise<PaymentArrangement[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const installments = await fetchAllRows('List arrangement instalments', (from, to) =>
      db
        .from('arrangement_installments')
        .select('*')
        .eq('company_id', companyId)
        .in('arrangement_id', ids)
        .order('arrangement_id', { ascending: true })
        .order('sequence', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )

    const byArrangement = new Map<EntityId, ArrangementInstallmentRow[]>()
    for (const installment of installments) {
      const list = byArrangement.get(installment.arrangement_id)
      if (list) list.push(installment)
      else byArrangement.set(installment.arrangement_id, [installment])
    }
    return rows.map((row) => toPaymentArrangement(row, byArrangement.get(row.id) ?? []))
  }
}
