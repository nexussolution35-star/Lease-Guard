import { ForbiddenException, Injectable } from '@nestjs/common'
import { leaseStatusAfterVerification, type EntityId, type Lease } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toLeaseFromQuery } from '../../infrastructure/database/lease-rows'
import { LEASE_SORT_COLUMNS, type LeaseListQuery } from './leases.schemas'

const SEARCH_COLUMNS = ['reference'] as const

/** Lease columns plus its bank guarantee (a to-many embed holding at most one row). */
const LEASE_SELECT = '*, lease_bank_guarantees(*)'

/**
 * Reads and verifies leases of one company. Every query runs through the caller's RLS-bound client and
 * also filters by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class LeasesService {
  async list(db: DbClient, companyId: EntityId, query: LeaseListQuery): Promise<Page<Lease>> {
    const filtered = () => {
      let request = db.from('leases').select(LEASE_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.unitId) request = request.eq('unit_id', query.unitId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.verified !== undefined) request = request.eq('verified', query.verified)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = LEASE_SORT_COLUMNS[query.sort ?? 'reference']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List leases')
      throw httpErrorFromDatabase(error, 'List leases')
    }
    return toPage(data, count, query, toLeaseFromQuery)
  }

  async get(db: DbClient, companyId: EntityId, leaseId: EntityId): Promise<Lease> {
    const row = unwrapDatabase(
      await db.from('leases').select(LEASE_SELECT).eq('company_id', companyId).eq('id', leaseId).maybeSingle(),
      'Get lease',
    )
    return toLeaseFromQuery(row)
  }

  /**
   * Marks the lease terms verified so they may drive financial monitoring. Only `verified` is written:
   * the `stamp_verification` trigger records the verifier (auth.uid()) and time, and the
   * `audit_verification` trigger writes the audit log, so neither can be forged by the client.
   *
   * Idempotent: verifying an already verified lease returns it unchanged (the original verifier and
   * time are kept). The update is conditional on `verified = false`, so concurrent requests stamp once.
   */
  async verify(db: DbClient, companyId: EntityId, leaseId: EntityId): Promise<Lease> {
    const current = await this.get(db, companyId, leaseId)
    if (current.verified) return current

    const { data, error } = await db
      .from('leases')
      // Verified terms make a draft or pending lease active (domain rule), so monitoring picks it up.
      .update({ verified: true, status: leaseStatusAfterVerification(current.status) })
      .eq('company_id', companyId)
      .eq('id', leaseId)
      .eq('verified', false)
      .select(LEASE_SELECT)
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Verify lease')
    if (data) return toLeaseFromQuery(data)

    // No row updated: either another request verified it first, or Row Level Security refused the write.
    const after = await this.get(db, companyId, leaseId)
    if (!after.verified) throw new ForbiddenException('You are not allowed to perform this action')
    return after
  }
}
