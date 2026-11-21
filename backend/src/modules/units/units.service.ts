import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type { EntityId, Unit, UnitListItem } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toUnit, toUnitListItem, type UnitRow } from './units.mapper'
import { UNIT_SORT_COLUMNS, type CreateUnitBody, type UnitListQuery, type UpdateUnitBody } from './units.schemas'

const SEARCH_COLUMNS = ['unit_number'] as const

type UnitChanges = Partial<Pick<UnitRow, 'unit_number' | 'type' | 'floor_area_sqm' | 'floor' | 'occupancy_status' | 'description'>>

/**
 * Database answers to a create or edit, in words for people. 23503 is the composite foreign key to the
 * company's properties; P0001 comes from the unit guard (archived property, leased unit stays occupied)
 * and is already written for users.
 */
function writeErrors(unitNumber: string | undefined): DatabaseErrorOverrides {
  return {
    '23503': () => new UnprocessableEntityException('Choose a property in this workspace'),
    '23505': () =>
      new ConflictException(
        unitNumber ? `A unit numbered ${unitNumber} already exists in this property` : 'A unit with this number already exists in this property',
      ),
    P0001: (error) => new UnprocessableEntityException(error.message),
  }
}

/**
 * The columns a new unit is inserted with: the one write path of the unit form and of an approved portfolio import
 * (which inserts the same columns inside its own transaction).
 */
export function unitInsertColumns(companyId: EntityId, body: CreateUnitBody) {
  return {
    company_id: companyId,
    property_id: body.propertyId,
    unit_number: body.unitNumber,
    type: body.type,
    floor_area_sqm: body.floorAreaSqm,
    floor: body.floor ?? null,
    occupancy_status: body.occupancyStatus ?? 'vacant',
    description: body.description ?? null,
  } satisfies Partial<UnitRow>
}

function changesFrom(body: UpdateUnitBody): UnitChanges {
  return {
    ...(body.unitNumber !== undefined ? { unit_number: body.unitNumber } : {}),
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.floorAreaSqm !== undefined ? { floor_area_sqm: body.floorAreaSqm } : {}),
    ...(body.floor !== undefined ? { floor: body.floor } : {}),
    ...(body.occupancyStatus !== undefined ? { occupancy_status: body.occupancyStatus } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
  }
}

/** The unit's assignments with the tenant's name; `toUnit` reads the current one. */
export const UNIT_ASSIGNMENT_EMBED =
  'assignments:unit_tenant_assignments!unit_tenant_assignments_unit_fk(id, tenant_id, assigned_at, ended_at, tenant:tenants!unit_tenant_assignments_tenant_fk(trading_name))'

/** A unit with its current assignment. */
export const UNIT_SELECT = `*, ${UNIT_ASSIGNMENT_EMBED}`

/**
 * Each listed unit with its property, its current tenant (the current lease's tenant, else the assigned tenant), its
 * current lease and its assignment, named through the composite company-scoped foreign keys so RLS applies to every
 * embedded row.
 */
export const UNIT_LIST_SELECT = `*, property:properties!units_property_fk(id, name, code), current_tenant:tenants!units_current_tenant_fk(id, trading_name), current_lease:leases!units_current_lease_fk(id, reference, commencement_date, expiry_date), ${UNIT_ASSIGNMENT_EMBED}`

/**
 * Units of one company. Every query runs through the caller's RLS-bound client and also filters
 * by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class UnitsService {
  async list(db: DbClient, companyId: EntityId, query: UnitListQuery): Promise<Page<UnitListItem>> {
    const filtered = () => {
      let request = db
        .from('units')
        .select(UNIT_LIST_SELECT, { count: 'exact' })
        .eq('company_id', companyId)
        .is('assignments.ended_at', null)
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
    return toPage(data, count, query, toUnitListItem)
  }

  async get(db: DbClient, companyId: EntityId, unitId: EntityId): Promise<Unit> {
    const row = unwrapDatabase(
      await db.from('units').select(UNIT_SELECT).eq('company_id', companyId).eq('id', unitId).is('assignments.ended_at', null).maybeSingle(),
      'Get unit',
    )
    return toUnit(row)
  }

  /**
   * Creates a unit in the active company. The database checks the rest: the property is in the company (23503), the
   * unit number is unique in the property (23505), the property is not archived (P0001), and it records the audit entry.
   */
  async create(db: DbClient, companyId: EntityId, body: CreateUnitBody): Promise<Unit> {
    const row = unwrapDatabase(
      await db.from('units').insert(unitInsertColumns(companyId, body)).select(UNIT_SELECT).single(),
      'Create unit',
      writeErrors(body.unitNumber),
    )
    return toUnit(row)
  }

  /**
   * Changes a unit of the active company; the database audits it. No row back means the unit is not in the company or
   * Row Level Security refused the write; the role guard has already answered 403 for members who only read, so 404.
   */
  async update(db: DbClient, companyId: EntityId, unitId: EntityId, body: UpdateUnitBody): Promise<Unit> {
    const row = unwrapDatabase(
      await db.from('units').update(changesFrom(body)).eq('company_id', companyId).eq('id', unitId).select(UNIT_SELECT).maybeSingle(),
      'Update unit',
      writeErrors(body.unitNumber),
    )
    return toUnit(row)
  }
}
