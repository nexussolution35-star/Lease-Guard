import { EVENT_PRIORITIES, MONITORING_DUE_WINDOWS, MONITORING_EVENT_STATUSES, MONITORING_EVENT_TYPES, UNASSIGNED_FILTER } from '@leaseguard/domain'
import { z } from 'zod'

import { isUuid } from '@/lib/data/ids'
import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { MONITORING_EVENT_SORT_FIELDS, type MonitoringEventListParams } from './api/source'

/** List state that is left out of the URL when unchanged: the most recently identified events first. */
export const MONITORING_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'identifiedOn',
  direction: 'desc',
} as const satisfies Partial<MonitoringEventListParams>

/**
 * The status filter as it reads in the URL: one status, or `open` (still needs attention) or `closed` (resolved or
 * dismissed), which the API reads as its `open` boolean.
 */
export const MONITORING_STATUS_GROUPS = ['open', 'closed'] as const
export const MONITORING_STATUS_FILTERS = [...MONITORING_STATUS_GROUPS, ...MONITORING_EVENT_STATUSES] as const
export type MonitoringStatusFilter = (typeof MONITORING_STATUS_FILTERS)[number]

const uuid = z.string().refine(isUuid).optional().catch(undefined)

/**
 * `/monitoring` search params. The list state lives in the URL (shareable, survives reloads and the back button, and
 * the dashboard links to filtered lists); invalid values fall back to defaults instead of failing the route.
 */
export const monitoringListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(MONITORING_LIST_DEFAULTS.page).catch(MONITORING_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(MONITORING_LIST_DEFAULTS.pageSize)
    .catch(MONITORING_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); the data source trims and caps it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(MONITORING_EVENT_SORT_FIELDS).default(MONITORING_LIST_DEFAULTS.sort).catch(MONITORING_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(MONITORING_LIST_DEFAULTS.direction).catch(MONITORING_LIST_DEFAULTS.direction),
  type: z.enum(MONITORING_EVENT_TYPES).optional().catch(undefined),
  priority: z.enum(EVENT_PRIORITIES).optional().catch(undefined),
  status: z.enum(MONITORING_STATUS_FILTERS).optional().catch(undefined),
  propertyId: uuid,
  unitId: uuid,
  tenantId: uuid,
  leaseId: uuid,
  assignee: z
    .string()
    .refine((value) => value === UNASSIGNED_FILTER || isUuid(value))
    .optional()
    .catch(undefined),
  due: z.enum(MONITORING_DUE_WINDOWS).optional().catch(undefined),
})

export type MonitoringListSearch = z.output<typeof monitoringListSearchSchema>

/** The API list params for the URL state: `open` and `closed` become the API's `open` boolean. */
export function monitoringListParamsFrom({ status, ...search }: MonitoringListSearch): MonitoringEventListParams {
  if (status === 'open') return { ...search, open: true }
  if (status === 'closed') return { ...search, open: false }
  return { ...search, ...(status === undefined ? {} : { status }) }
}
