import { PROPERTY_STATUSES, PROPERTY_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { PROPERTY_SORT_FIELDS, type PropertyListParams } from './api/source'

/** List state that is left out of the URL when unchanged. */
export const PROPERTY_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'name',
  direction: 'asc',
} as const satisfies Partial<PropertyListParams>

/**
 * `/properties` search params. The list state lives in the URL (shareable, survives reloads and the
 * back button); invalid values fall back to defaults instead of failing the route.
 */
export const propertyListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(PROPERTY_LIST_DEFAULTS.page).catch(PROPERTY_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(PROPERTY_LIST_DEFAULTS.pageSize)
    .catch(PROPERTY_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); data sources trim and cap it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(PROPERTY_SORT_FIELDS).default(PROPERTY_LIST_DEFAULTS.sort).catch(PROPERTY_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(PROPERTY_LIST_DEFAULTS.direction).catch(PROPERTY_LIST_DEFAULTS.direction),
  status: z.enum(PROPERTY_STATUSES).optional().catch(undefined),
  type: z.enum(PROPERTY_TYPES).optional().catch(undefined),
})

export type PropertyListSearch = z.output<typeof propertyListSearchSchema>
