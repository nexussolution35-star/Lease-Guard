import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import {
  compareISODate,
  expiringWithinRange,
  leaseStatusAfterVerification,
  type EntityId,
  type Lease,
  type LeaseListItem,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import { saToday } from '../../common/sa-today'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toLeaseFromQuery, type LeaseWithGuaranteeRow } from '../../infrastructure/database/lease-rows'
import { LEASE_SORT_COLUMNS, type CreateLeaseBody, type LeaseListQuery, type UpdateLeaseBody } from './leases.schemas'
import { guaranteeColumns, leaseChangesFrom, leaseInsertFrom } from './leases.writes'

/**
 * The list search matches the reference or the tenant's trading and legal names. `tenant_search_text` is a
 * computed field (a SECURITY INVOKER function of the lease row, 20261120143700_lease_list_tenant_search.sql):
 * PostgREST cannot filter on an embedded table inside a top-level `or`.
 */
const SEARCH_COLUMNS = ['reference', 'tenant_search_text'] as const

/** Lease columns plus its bank guarantee (a to-many embed holding at most one row). */
const LEASE_SELECT = '*, lease_bank_guarantees(*)'

/** A list row also names its tenant, property and unit (to-one embeds over the composite foreign keys). */
const LEASE_LIST_SELECT =
  `${LEASE_SELECT}, tenant:tenants!leases_tenant_fk(trading_name), property:properties!leases_property_fk(name), unit:units!leases_unit_fk(unit_number)`

type LeaseListRow = LeaseWithGuaranteeRow & {
  tenant: { trading_name: string } | null
  property: { name: string } | null
  unit: { unit_number: string } | null
}

function toLeaseListItem({ tenant, property, unit, ...row }: LeaseListRow): LeaseListItem {
  return {
    ...toLeaseFromQuery(row),
    tenantName: tenant?.trading_name ?? '',
    propertyName: property?.name ?? '',
    unitNumber: unit?.unit_number ?? '',
  }
}

/**
 * Database answers to a create or edit, in words for people. P0001 comes from the lease guard (parties, archived
 * property, parties of a lease in use) and is already written for users; 23503 is a party the caller cannot see.
 */
const WRITE_ERRORS: DatabaseErrorOverrides = {
  '23503': () => new UnprocessableEntityException('The tenant, property and unit must belong to this workspace'),
  P0001: (error) => new UnprocessableEntityException(error.message),
}

const referenceTaken = (reference: string) => () =>
  new ConflictException(`A lease with the reference ${reference} already exists in this workspace`)

/**
 * Reads, creates, edits and verifies leases of one company. Every query runs through the caller's RLS-bound client and
 * also filters by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class LeasesService {
  /** `now` is the clock for the "expiring within" window (tests pass one); the window uses the South African date. */
  async list(db: DbClient, companyId: EntityId, query: LeaseListQuery, now: Date = new Date()): Promise<Page<LeaseListItem>> {
    const expiring = query.expiresWithinDays === undefined ? null : expiringWithinRange(saToday(now), query.expiresWithinDays)
    const filtered = () => {
      let request = db.from('leases').select(LEASE_LIST_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.unitId) request = request.eq('unit_id', query.unitId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.verified !== undefined) request = request.eq('verified', query.verified)
      if (expiring) request = request.gte('expiry_date', expiring.from).lte('expiry_date', expiring.to)
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
    return toPage(data, count, query, toLeaseListItem)
  }

  async get(db: DbClient, companyId: EntityId, leaseId: EntityId): Promise<Lease> {
    const row = unwrapDatabase(
      await db.from('leases').select(LEASE_SELECT).eq('company_id', companyId).eq('id', leaseId).maybeSingle(),
      'Get lease',
    )
    return toLeaseFromQuery(row)
  }

  /**
   * Creates an unverified lease (pending verification unless `draft`) and its bank guarantee, if any, in one
   * transaction (`public.save_lease`, under the caller's RLS). The database checks the rest: the reference is unique
   * (23505 → 409), the tenant, property and unit belong to the company and the unit to the property, the property is
   * not archived (P0001 → 422), and it records the audit entries.
   */
  async create(db: DbClient, companyId: EntityId, body: CreateLeaseBody): Promise<Lease> {
    const id = unwrapDatabase(
      await db.rpc('save_lease', {
        p_company_id: companyId,
        p_lease: leaseInsertFrom(body),
        p_set_guarantee: Boolean(body.bankGuarantee),
        ...(body.bankGuarantee ? { p_guarantee: guaranteeColumns(body.bankGuarantee) } : {}),
      }),
      'Create lease',
      { ...WRITE_ERRORS, '23505': referenceTaken(body.reference) },
    )
    return this.get(db, companyId, id)
  }

  /**
   * Changes a lease of the active company; omitted fields are unchanged and `bankGuarantee: null` removes the
   * guarantee. A change to a term of a verified lease returns it to pending verification: the database does that
   * for every writer (`reset_verification` and `guarantee_change` triggers) and audits it, so unverified terms never
   * drive monitoring. The merged dates are checked here so the answer names the field.
   */
  async update(db: DbClient, companyId: EntityId, leaseId: EntityId, body: UpdateLeaseBody): Promise<Lease> {
    const current = await this.get(db, companyId, leaseId)
    const commencement = body.commencementDate ?? current.commencementDate
    const expiry = body.expiryDate ?? current.expiryDate
    if (compareISODate(expiry, commencement) <= 0) {
      throw new UnprocessableEntityException('The expiry date must be after the commencement date')
    }

    const id = unwrapDatabase(
      await db.rpc('save_lease', {
        p_company_id: companyId,
        p_lease_id: leaseId,
        p_lease: leaseChangesFrom(body),
        p_set_guarantee: body.bankGuarantee !== undefined,
        ...(body.bankGuarantee ? { p_guarantee: guaranteeColumns(body.bankGuarantee) } : {}),
      }),
      'Update lease',
      { ...WRITE_ERRORS, '23505': referenceTaken(body.reference ?? current.reference) },
    )
    return this.get(db, companyId, id)
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
