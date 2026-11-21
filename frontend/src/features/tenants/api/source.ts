import type { CreateTenantDto, TenantSortField, UpdateTenantDto } from '@leaseguard/api-client'
import type { BusinessType, EntityId, Tenant, TenantListItem, TenantStatus } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { TenantSortField }

/** Sort fields accepted by `GET /api/v1/tenants` (generated from the backend's OpenAPI document). */
export const TENANT_SORT_FIELDS = ['tradingName', 'legalName', 'status', 'createdAt'] as const satisfies readonly TenantSortField[]

/** Filters accepted by `GET /api/v1/tenants`, each a single optional value. */
export interface TenantListParams extends ListParams<TenantSortField> {
  status?: TenantStatus
  businessType?: BusinessType
  /** Only tenants with a lease in this property. */
  propertyId?: EntityId
}

/**
 * Where tenants come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages (each tenant with its current lease) and `get` resolves to null when the record is not in that company.
 */
export interface TenantSource {
  list(companyId: EntityId, params: TenantListParams): Promise<Page<TenantListItem>>
  get(companyId: EntityId, id: EntityId): Promise<Tenant | null>
  /** Company admins and property managers. Rejects with 400 (and the format to use) for an invalid WhatsApp number. */
  create(companyId: EntityId, tenant: NewTenant): Promise<Tenant>
  /** A different WhatsApp number comes back unvalidated (automated communication off until it is validated). */
  update(companyId: EntityId, id: EntityId, changes: TenantChanges): Promise<Tenant>
  /**
   * Company writers: a member confirmed with the tenant that `whatsappNumber` is its WhatsApp number. Rejects with 409
   * when the number on record changed since it was checked; resolves to the tenant with who validated it and when.
   */
  validateWhatsApp(companyId: EntityId, id: EntityId, whatsappNumber: string): Promise<Tenant>
}

/** `POST /tenants` body. The WhatsApp number may be typed as people write it; the API stores it in E.164. */
export type NewTenant = CreateTenantDto

/** `PATCH /tenants/{id}` body: omitted fields are unchanged; empty or null clears an optional field. */
export type TenantChanges = UpdateTenantDto
