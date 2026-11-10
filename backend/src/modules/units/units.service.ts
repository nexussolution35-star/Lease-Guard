import { Injectable } from '@nestjs/common'
import type { EntityId, Unit } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toUnit } from './units.mapper'
import { UNIT_SORT_COLUMNS, type UnitListQuery } from './units.schemas'

const SEARCH_COLUMNS = ['unit_number'] as const

/**
 * Reads units of one company. Every query runs through the caller's RLS-bound client and also filters
 * by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class UnitsService {
  async list(db: DbClient, companyId: EntityId, query: UnitListQuery): Promise<Page<Unit>> {
    const filtered = () => {
      let request = db.from('units').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.occupancyStatus) request = request.eq('occupancy_status', query.occupancyStatus)
      if (query.type) request = request.eq('type', query.type)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = UNIT_SORT_COLUMNS[query.sort ?? 'unitNumber']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List units')
      throw httpErrorFromDatabase(error, 'List units')
    }
    return toPage(data, count, query, toUnit)
  }

  async get(db: DbClient, companyId: EntityId, unitId: EntityId): Promise<Unit> {
    const row = unwrapDatabase(
      await db.from('units').select('*').eq('company_id', companyId).eq('id', unitId).maybeSingle(),
      'Get unit',
    )
    return toUnit(row)
  }
}
