import { STATEMENT_SOURCES, STATEMENT_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { isUuid } from '@/lib/data/ids'
import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { STATEMENT_SORT_FIELDS, type StatementListParams } from './api/source'

/** List state that is left out of the URL when unchanged: newest uploads first. */
export const STATEMENT_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'uploadedAt',
  direction: 'desc',
} as const satisfies Partial<StatementListParams>

/**
 * `/statements` search params. The list state lives in the URL (shareable, survives reloads and the back
 * button); invalid values fall back to defaults instead of failing the route.
 */
export const statementListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(STATEMENT_LIST_DEFAULTS.page).catch(STATEMENT_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(STATEMENT_LIST_DEFAULTS.pageSize)
    .catch(STATEMENT_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); the data source trims and caps it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(STATEMENT_SORT_FIELDS).default(STATEMENT_LIST_DEFAULTS.sort).catch(STATEMENT_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(STATEMENT_LIST_DEFAULTS.direction).catch(STATEMENT_LIST_DEFAULTS.direction),
  status: z.enum(STATEMENT_STATUSES).optional().catch(undefined),
  propertyId: z.string().refine(isUuid).optional().catch(undefined),
  sourceSystem: z.enum(STATEMENT_SOURCES).optional().catch(undefined),
  /** One upload batch, as the upload screen links to it. */
  uploadBatchId: z.string().trim().min(1).max(100).optional().catch(undefined),
})

export type StatementListSearch = z.output<typeof statementListSearchSchema>
