import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, UnitTenantAssignmentListItem } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toUnitAssignmentListItem, UNIT_ASSIGNMENT_SELECT, type UnitAssignmentListRow } from './unit-assignments.mapper'
import {
  UNIT_ASSIGNMENT_SORT_COLUMNS,
  type CreateUnitAssignmentBody,
  type UnitAssignmentListQuery,
} from './unit-assignments.schemas'

/**
 * Database answers to assign and unassign, in words for people. P0001 is a conflict the database words itself (who
 * holds the unit, an archived property, an assignment already ended): 409. P0002 is a tenant, unit or assignment that
 * is not in the company: 404. 42501 (not a writer) keeps the default 403.
 */
const WRITE_ERRORS: DatabaseErrorOverrides = {
  P0001: (error) => new ConflictException(error.message),
  P0002: (error) => new NotFoundException(error.message),
}

/**
 * Tenants assigned to units without a lease (ticket M4-04). Reads go through the caller's RLS-bound client and also
 * filter by company. Assign and unassign call the database functions, which check the role and every rule, keep the
 * unit's occupancy and current tenant in step, and write the audit entry; the API only names the answer.
 */
@Injectable()
export class UnitAssignmentsService {
  async list(db: DbClient, companyId: EntityId, query: UnitAssignmentListQuery): Promise<Page<UnitTenantAssignmentListItem>> {
    const filtered = () => {
      let request = db.from('unit_tenant_assignments').select(UNIT_ASSIGNMENT_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.unitId) request = request.eq('unit_id', query.unitId)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.current === true) request = request.is('ended_at', null)
      if (query.current === false) request = request.not('ended_at', 'is', null)
      return request
    }

    // Newest first unless asked otherwise: the default `asc` direction is for the other lists' names.
    const sortColumn = UNIT_ASSIGNMENT_SORT_COLUMNS[query.sort ?? 'assignedAt']
    const ascending = query.sort === undefined ? false : query.direction === 'asc'
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List unit assignments')
      throw httpErrorFromDatabase(error, 'List unit assignments')
    }
    return toPage(data as unknown as UnitAssignmentListRow[] | null, count, query, toUnitAssignmentListItem)
  }

  async get(db: DbClient, companyId: EntityId, assignmentId: EntityId): Promise<UnitTenantAssignmentListItem> {
    const row = unwrapDatabase(
      await db.from('unit_tenant_assignments').select(UNIT_ASSIGNMENT_SELECT).eq('company_id', companyId).eq('id', assignmentId).maybeSingle(),
      'Get unit assignment',
    )
    return toUnitAssignmentListItem(row as unknown as UnitAssignmentListRow)
  }

  /**
   * Assigns the tenant to the unit. The database refuses a unit let or assigned to another tenant (naming who holds it),
   * a unit of an archived property, and a tenant or unit of another company; it marks the unit occupied and audits the
   * assignment. Assigning the tenant who already holds the unit returns the current assignment.
   */
  async assign(db: DbClient, companyId: EntityId, body: CreateUnitAssignmentBody): Promise<UnitTenantAssignmentListItem> {
    const id = unwrapDatabase(
      await db.rpc('assign_tenant_to_unit', { p_company_id: companyId, p_tenant_id: body.tenantId, p_unit_id: body.unitId }),
      'Assign tenant to unit',
      WRITE_ERRORS,
    )
    return this.get(db, companyId, id)
  }

  /**
   * Ends a current assignment; it stays as history. The unit returns to vacant unless a lease keeps it occupied; the
   * database audits it.
   */
  async end(db: DbClient, companyId: EntityId, assignmentId: EntityId): Promise<UnitTenantAssignmentListItem> {
    unwrapDatabase(
      await db.rpc('end_unit_tenant_assignment', { p_company_id: companyId, p_assignment_id: assignmentId }),
      'Unassign tenant from unit',
      WRITE_ERRORS,
    )
    return this.get(db, companyId, assignmentId)
  }
}
