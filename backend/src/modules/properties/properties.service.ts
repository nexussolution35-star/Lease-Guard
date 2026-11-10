import { Injectable } from '@nestjs/common'
import type { EntityId, Property } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toProperty } from './properties.mapper'
import { PROPERTY_SORT_COLUMNS, type PropertyListQuery } from './properties.schemas'

const SEARCH_COLUMNS = ['name', 'code', 'city', 'suburb'] as const

/**
 * Reads properties of one company. Every query runs through the caller's RLS-bound client and also
 * filters by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class PropertiesService {
  async list(db: DbClient, companyId: EntityId, query: PropertyListQuery): Promise<Page<Property>> {
    const filtered = () => {
      let request = db.from('properties').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.type) request = request.eq('type', query.type)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = PROPERTY_SORT_COLUMNS[query.sort ?? 'name']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List properties')
      throw httpErrorFromDatabase(error, 'List properties')
    }
    return toPage(data, count, query, toProperty)
  }

  async get(db: DbClient, companyId: EntityId, propertyId: EntityId): Promise<Property> {
    const row = unwrapDatabase(
      await db.from('properties').select('*').eq('company_id', companyId).eq('id', propertyId).maybeSingle(),
      'Get property',
    )
    return toProperty(row)
  }
}
