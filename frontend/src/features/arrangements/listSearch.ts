import { ARRANGEMENT_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { isUuid } from '@/lib/data/ids'
import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { ARRANGEMENT_SORT_FIELDS, type ArrangementListParams } from './api/source'

/** List state that is left out of the URL when unchanged: the most recently agreed arrangements first. */
export const ARRANGEMENT_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'agreedOn',
  direction: 'desc',
} as const satisfies Partial<ArrangementListParams>

const uuid = z.string().refine(isUuid).optional().catch(undefined)

/**
 * `/arrangements` search params. The list state lives in the URL (shareable, survives reloads and the back button, and
 * the dashboard and tenant pages link to filtered lists); invalid values fall back to defaults instead of failing the
 * route.
 */
export const arrangementListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(ARRANGEMENT_LIST_DEFAULTS.page).catch(ARRANGEMENT_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(ARRANGEMENT_LIST_DEFAULTS.pageSize)
    .catch(ARRANGEMENT_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); the data source trims and caps it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(ARRANGEMENT_SORT_FIELDS).default(ARRANGEMENT_LIST_DEFAULTS.sort).catch(ARRANGEMENT_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(ARRANGEMENT_LIST_DEFAULTS.direction).catch(ARRANGEMENT_LIST_DEFAULTS.direction),
  status: z.enum(ARRANGEMENT_STATUSES).optional().catch(undefined),
  propertyId: uuid,
  tenantId: uuid,
})

export type ArrangementListSearch = z.output<typeof arrangementListSearchSchema>
