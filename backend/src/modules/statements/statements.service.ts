import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, Statement, StatementExtraction } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { fetchAllRows } from '../../common/http/fetch-all'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toStatement, toStatementExtraction, type StatementLineItemRow, type StatementRow } from './statements.mapper'
import { STATEMENT_SORT_COLUMNS, type StatementListQuery } from './statements.schemas'

const SEARCH_COLUMNS = ['file_name', 'statement_number'] as const

/**
 * Reads statements, their line items and extractions for one company. Every query runs through the
 * caller's RLS-bound client and also filters by company explicitly.
 */
@Injectable()
export class StatementsService {
  async list(db: DbClient, companyId: EntityId, query: StatementListQuery): Promise<Page<Statement>> {
    const filtered = () => {
      let request = db.from('statements').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.leaseId) request = request.eq('lease_id', query.leaseId)
      if (query.sourceSystem) request = request.eq('source_system', query.sourceSystem)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = STATEMENT_SORT_COLUMNS[query.sort ?? 'uploadedAt']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List statements')
      throw httpErrorFromDatabase(error, 'List statements')
    }

    const rows = data ?? []
    const items = await this.withChildren(db, companyId, rows)
    return { items, total: count ?? 0, page: query.page, pageSize: query.pageSize }
  }

  async get(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<Statement> {
    const row = unwrapDatabase(
      await db.from('statements').select('*').eq('company_id', companyId).eq('id', statementId).maybeSingle(),
      'Get statement',
    )
    const [statement] = await this.withChildren(db, companyId, [row])
    if (!statement) throw new NotFoundException('The record was not found')
    return statement
  }

  /** The extractor's latest proposal for a statement, with every extracted field. */
  async getExtraction(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<StatementExtraction> {
    const { data: extraction, error } = await db
      .from('statement_extractions')
      .select('*')
      .eq('company_id', companyId)
      .eq('statement_id', statementId)
      .order('extracted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Get statement extraction')
    if (!extraction) throw new NotFoundException('The statement has no extraction yet')

    const { data: fields, error: fieldsError } = await db
      .from('statement_extraction_fields')
      .select('*')
      .eq('company_id', companyId)
      .eq('extraction_id', extraction.id)
    if (fieldsError) throw httpErrorFromDatabase(fieldsError, 'Get statement extraction fields')
    return toStatementExtraction(extraction, fields ?? [])
  }

  /**
   * Loads line items and extraction ids for a page of statements (not one query per row). A page of
   * statements can hold more line items than the Data API returns at once, so they are read page by
   * page. Each statement has at most one extraction, so those fit in one response.
   */
  private async withChildren(db: DbClient, companyId: EntityId, rows: readonly StatementRow[]): Promise<Statement[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    const [lineItems, extractions] = await Promise.all([
      fetchAllRows('List statement line items', (from, to) =>
        db
          .from('statement_line_items')
          .select('*')
          .eq('company_id', companyId)
          .in('statement_id', ids)
          .order('statement_id', { ascending: true })
          .order('line_number', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
      db.from('statement_extractions').select('id, statement_id').eq('company_id', companyId).in('statement_id', ids),
    ])
    if (extractions.error) throw httpErrorFromDatabase(extractions.error, 'List statement extractions')

    const itemsByStatement = new Map<EntityId, StatementLineItemRow[]>()
    for (const item of lineItems) {
      const list = itemsByStatement.get(item.statement_id)
      if (list) list.push(item)
      else itemsByStatement.set(item.statement_id, [item])
    }
    const extractionByStatement = new Map((extractions.data ?? []).map((row) => [row.statement_id, row.id]))

    return rows.map((row) => toStatement(row, itemsByStatement.get(row.id) ?? [], extractionByStatement.get(row.id)))
  }
}
