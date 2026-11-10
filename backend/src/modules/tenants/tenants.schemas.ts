import { BUSINESS_TYPES, TENANT_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const TENANT_SORT_FIELDS = ['tradingName', 'legalName', 'status', 'createdAt'] as const

// No propertyId filter: tenants have no property column. A tenant's properties follow from its leases
// (filter GET /leases by tenantId or propertyId instead).
export const tenantListQuerySchema = listQuerySchema(TENANT_SORT_FIELDS, {
  status: z.enum(TENANT_STATUSES).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional(),
})
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>

/** API sort field → database column. */
export const TENANT_SORT_COLUMNS = {
  tradingName: 'trading_name',
  legalName: 'legal_name',
  status: 'status',
  createdAt: 'created_at',
} as const satisfies Record<(typeof TENANT_SORT_FIELDS)[number], string>
