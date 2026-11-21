import { OCCUPANCY_STATUSES, UNIT_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { UNIT_SORT_FIELDS, type UnitListParams } from './api/source'

/** List state that is left out of the URL when unchanged. */
export const UNIT_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'unitNumber',
  direction: 'asc',
} as const satisfies Partial<UnitListParams>

/**
 * `/units` search params. The list state lives in the URL (shareable, survives reloads and the back
 * button); invalid values fall back to defaults instead of failing the route.
 */
export const unitListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(UNIT_LIST_DEFAULTS.page).catch(UNIT_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(UNIT_LIST_DEFAULTS.pageSize)
    .catch(UNIT_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); data sources trim and cap it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(UNIT_SORT_FIELDS).default(UNIT_LIST_DEFAULTS.sort).catch(UNIT_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(UNIT_LIST_DEFAULTS.direction).catch(UNIT_LIST_DEFAULTS.direction),
  // The API rejects a malformed property id, so one in the URL is dropped instead of failing the list.
  propertyId: z.uuid().optional().catch(undefined),
  type: z.enum(UNIT_TYPES).optional().catch(undefined),
  occupancyStatus: z.enum(OCCUPANCY_STATUSES).optional().catch(undefined),
})

export type UnitListSearch = z.output<typeof unitListSearchSchema>
