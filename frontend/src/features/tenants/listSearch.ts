import { TENANT_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { TENANT_SORT_FIELDS, type TenantListParams } from './api/source'

/** List state that is left out of the URL when unchanged. */
export const TENANT_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'tradingName',
  direction: 'asc',
} as const satisfies Partial<TenantListParams>

/**
 * `/tenants` search params. The list state lives in the URL (shareable, survives reloads and the
 * back button); invalid values fall back to defaults instead of failing the route.
 */
export const tenantListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(TENANT_LIST_DEFAULTS.page).catch(TENANT_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(TENANT_LIST_DEFAULTS.pageSize)
    .catch(TENANT_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); data sources trim and cap it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(TENANT_SORT_FIELDS).default(TENANT_LIST_DEFAULTS.sort).catch(TENANT_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(TENANT_LIST_DEFAULTS.direction).catch(TENANT_LIST_DEFAULTS.direction),
  status: z.enum(TENANT_STATUSES).optional().catch(undefined),
  propertyId: z.uuid().optional().catch(undefined),
})

export type TenantListSearch = z.output<typeof tenantListSearchSchema>
