import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, Tenant, TenantListItem } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { TENANT_LEASE_COLUMNS, toTenant, toTenantListItem, type TenantListRow } from './tenants.mapper'
import {
  TENANT_SORT_COLUMNS,
  type CreateTenantBody,
  type TenantListQuery,
  type UpdateTenantBody,
  type ValidateTenantWhatsAppBody,
} from './tenants.schemas'
import { tenantChangesFrom, tenantInsertFrom } from './tenants.writes'

const SEARCH_COLUMNS = ['legal_name', 'trading_name', 'contact_full_name'] as const

/** What `public.validate_tenant_whatsapp_number` answered. */
type ValidationOutcome = 'validated' | 'already_validated' | 'number_changed' | 'not_found'

export const NUMBER_CHANGED_MESSAGE =
  "The tenant's WhatsApp number has changed since it was checked. Check the number now on record and validate that one."

/**
 * Tenants of one company: read, create and edit. Every query runs through the caller's RLS-bound client and also filters
 * by company explicitly, so a member of several companies only sees the active one.
 */
@Injectable()
export class TenantsService {
  /**
   * Tenants with their leases embedded, for the list's unit and lease reference. A property filter turns the embed
   * into an inner join (keeps only tenants with a lease there) and narrows the embedded leases to that property.
   */
  async list(db: DbClient, companyId: EntityId, query: TenantListQuery): Promise<Page<TenantListItem>> {
    const leases = `leases!leases_tenant_fk${query.propertyId ? '!inner' : ''}(${TENANT_LEASE_COLUMNS})`
    const filtered = () => {
      let request = db.from('tenants').select(`*, ${leases}`, { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.businessType) request = request.eq('business_type', query.businessType)
      if (query.propertyId) request = request.eq('leases.property_id', query.propertyId)
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
    return toPage(data as unknown as TenantListRow[] | null, count, query, toTenantListItem)
  }

  async get(db: DbClient, companyId: EntityId, tenantId: EntityId): Promise<Tenant> {
    const row = unwrapDatabase(
      await db.from('tenants').select('*').eq('company_id', companyId).eq('id', tenantId).maybeSingle(),
      'Get tenant',
    )
    return toTenant(row)
  }

  /**
   * Creates a tenant in the active company. The number arrives in E.164 (the body schema normalises it) and starts
   * unvalidated, so automated communication stays off until it is validated. The database records the audit entry.
   */
  async create(db: DbClient, companyId: EntityId, body: CreateTenantBody): Promise<Tenant> {
    const row = unwrapDatabase(
      await db.from('tenants').insert(tenantInsertFrom(companyId, body)).select('*').single(),
      'Create tenant',
    )
    return toTenant(row)
  }

  /**
   * Changes a tenant of the active company. A different WhatsApp number is unvalidated again: the database resets the
   * flag in the same write and audits the change. No row back means the tenant is not in the company or Row Level
   * Security refused the write; the role guard has already answered 403 for members who only read, so this is a 404.
   */
  async update(db: DbClient, companyId: EntityId, tenantId: EntityId, body: UpdateTenantBody): Promise<Tenant> {
    const row = unwrapDatabase(
      await db.from('tenants').update(tenantChangesFrom(body)).eq('company_id', companyId).eq('id', tenantId).select('*').maybeSingle(),
      'Update tenant',
    )
    return toTenant(row)
  }

  /**
   * A writer validates the tenant's WhatsApp number: the person confirmed that `body.whatsappNumber` is the tenant's
   * WhatsApp number, which turns automated communication on as far as the number goes. The database checks the role,
   * validates only the number still on record (409 otherwise), stamps who and when, and records a `verify` audit entry.
   * Validating a validated number returns the tenant unchanged.
   */
  async validateWhatsApp(db: DbClient, companyId: EntityId, tenantId: EntityId, body: ValidateTenantWhatsAppBody): Promise<Tenant> {
    const rows = unwrapDatabase(
      await db.rpc('validate_tenant_whatsapp_number', { p_company_id: companyId, p_tenant_id: tenantId, p_whatsapp_number: body.whatsappNumber }),
      'Validate tenant WhatsApp number',
    ) as { outcome: ValidationOutcome }[]
    const outcome = rows[0]?.outcome
    if (outcome === 'not_found') throw new NotFoundException('Tenant not found')
    if (outcome === 'number_changed') throw new ConflictException(NUMBER_CHANGED_MESSAGE)
    if (outcome !== 'validated' && outcome !== 'already_validated') {
      throw new Error(`validate_tenant_whatsapp_number answered ${JSON.stringify(outcome)}`)
    }
    return this.get(db, companyId, tenantId)
  }
}
