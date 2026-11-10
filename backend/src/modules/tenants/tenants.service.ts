import { Injectable } from '@nestjs/common'
import type { EntityId, Tenant } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toTenant } from './tenants.mapper'
import { TENANT_SORT_COLUMNS, type TenantListQuery } from './tenants.schemas'

const SEARCH_COLUMNS = ['legal_name', 'trading_name', 'contact_full_name'] as const

/**
 * Reads tenants of one company. Every query runs through the caller's RLS-bound client and also filters
 * by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class TenantsService {
  async list(db: DbClient, companyId: EntityId, query: TenantListQuery): Promise<Page<Tenant>> {
    const filtered = () => {
      let request = db.from('tenants').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.businessType) request = request.eq('business_type', query.businessType)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = TENANT_SORT_COLUMNS[query.sort ?? 'tradingName']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List tenants')
      throw httpErrorFromDatabase(error, 'List tenants')
    }
    return toPage(data, count, query, toTenant)
  }

  async get(db: DbClient, companyId: EntityId, tenantId: EntityId): Promise<Tenant> {
    const row = unwrapDatabase(
      await db.from('tenants').select('*').eq('company_id', companyId).eq('id', tenantId).maybeSingle(),
      'Get tenant',
    )
    return toTenant(row)
  }
}
