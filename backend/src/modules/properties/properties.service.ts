import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type { EntityId, Property } from '@leaseguard/domain'

import { conflictWithDatabaseMessage, httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toProperty } from './properties.mapper'
import { PROPERTY_SORT_COLUMNS, type CreatePropertyBody, type PropertyListQuery, type UpdatePropertyBody } from './properties.schemas'
import type { PropertyRow } from './properties.mapper'

const SEARCH_COLUMNS = ['name', 'code', 'city', 'suburb'] as const

type PropertyChanges = Partial<Omit<PropertyRow, 'id' | 'company_id' | 'code' | 'country' | 'created_at' | 'updated_at'>>

/** The manager or owner is not a member of the company (composite foreign key to company_users). */
const notAMember = () => new UnprocessableEntityException('The property manager and owner must be members of this workspace')

/**
 * Database answers to a create or edit, in words for people. P0001 comes from the property guard
 * (manager role, archived property) and is already written for users.
 */
const WRITE_ERRORS: DatabaseErrorOverrides = {
  '23503': notAMember,
  P0001: (error) => new UnprocessableEntityException(error.message),
}

function addressColumns(address: CreatePropertyBody['address']) {
  return {
    address_line1: address.line1,
    address_line2: address.line2 ?? null,
    suburb: address.suburb,
    city: address.city,
    province: address.province,
    postal_code: address.postalCode,
  }
}

function changesFrom(body: UpdatePropertyBody): PropertyChanges {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.address !== undefined ? addressColumns(body.address) : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.grossLettableAreaSqm !== undefined ? { gross_lettable_area_sqm: body.grossLettableAreaSqm } : {}),
    ...(body.managerUserId !== undefined ? { manager_user_id: body.managerUserId } : {}),
    ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
    ...(body.accountingSystem !== undefined ? { accounting_system: body.accountingSystem } : {}),
  }
}

/**
 * Properties of one company. Every query runs through the caller's RLS-bound client and also
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

  /**
   * Creates a property in the active company. The database checks the rest: the manager is a company admin or
   * property manager of the company (P0001), the manager and owner are members (23503), the code is unique (23505),
   * and it records the audit entry.
   */
  async create(db: DbClient, companyId: EntityId, body: CreatePropertyBody): Promise<Property> {
    const row = unwrapDatabase(
      await db
        .from('properties')
        .insert({
          company_id: companyId,
          name: body.name,
          code: body.code,
          type: body.type,
          status: body.status ?? 'active',
          ...addressColumns(body.address),
          description: body.description ?? '',
          gross_lettable_area_sqm: body.grossLettableAreaSqm,
          manager_user_id: body.managerUserId,
          owner_user_id: body.ownerUserId ?? null,
          accounting_system: body.accountingSystem,
        })
        .select('*')
        .single(),
      'Create property',
      { ...WRITE_ERRORS, '23505': () => new ConflictException(`A property with the code ${body.code} already exists in this workspace`) },
    )
    return toProperty(row)
  }

  /** Changes a property of the active company. An archived property is read-only until restored (P0001 → 422). */
  async update(db: DbClient, companyId: EntityId, propertyId: EntityId, body: UpdatePropertyBody): Promise<Property> {
    return this.write(db, companyId, propertyId, changesFrom(body), 'Update property', WRITE_ERRORS)
  }

  /**
   * Archives a property; it then stays read-only. Refused with 409 while the property has a lease that has not ended
   * (the database rule). Archiving an archived property returns it unchanged.
   */
  async archive(db: DbClient, companyId: EntityId, propertyId: EntityId): Promise<Property> {
    const current = await this.get(db, companyId, propertyId)
    if (current.status === 'archived') return current
    return this.write(db, companyId, propertyId, { status: 'archived' }, 'Archive property', { P0001: conflictWithDatabaseMessage })
  }

  /** Makes an archived property active again. Restoring a property that is not archived returns it unchanged. */
  async restore(db: DbClient, companyId: EntityId, propertyId: EntityId): Promise<Property> {
    const current = await this.get(db, companyId, propertyId)
    if (current.status !== 'archived') return current
    return this.write(db, companyId, propertyId, { status: 'active' }, 'Restore property')
  }

  /**
   * One update through the caller's RLS client. No row back means the property is not in the company or Row Level
   * Security refused the write; the role guard has already answered 403 for members who only read, so this is a 404.
   */
  private async write(
    db: DbClient,
    companyId: EntityId,
    propertyId: EntityId,
    changes: PropertyChanges,
    operation: string,
    overrides: DatabaseErrorOverrides = {},
  ): Promise<Property> {
    const row = unwrapDatabase(
      await db.from('properties').update(changes).eq('company_id', companyId).eq('id', propertyId).select('*').maybeSingle(),
      operation,
      overrides,
    )
    return toProperty(row)
  }
}
