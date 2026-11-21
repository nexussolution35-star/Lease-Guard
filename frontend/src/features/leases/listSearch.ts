import { EXPIRING_WITHIN_DAY_OPTIONS, LEASE_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { isUuid } from '@/lib/data/ids'
import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { LEASE_SORT_FIELDS, type LeaseListParams } from './api/source'

/** List state that is left out of the URL when unchanged. */
export const LEASE_LIST_DEFAULTS = {
  page: 1,
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  sort: 'reference',
  direction: 'asc',
} as const satisfies Partial<LeaseListParams>

/** The verification filter as it reads in the URL (`?verification=unverified`). */
export const LEASE_VERIFICATION_FILTERS = ['verified', 'unverified'] as const
export type LeaseVerificationFilter = (typeof LEASE_VERIFICATION_FILTERS)[number]

/**
 * `/leases` search params. The list state lives in the URL (shareable, survives reloads and the back
 * button); invalid values fall back to defaults instead of failing the route. "Expiring within" accepts
 * only the offered day counts.
 */
export const leaseListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(LEASE_LIST_DEFAULTS.page).catch(LEASE_LIST_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_PAGE_SIZE)
    .default(LEASE_LIST_DEFAULTS.pageSize)
    .catch(LEASE_LIST_DEFAULTS.pageSize),
  // Kept exactly as typed (the search box mirrors it while typing); data sources trim and cap it.
  search: z.string().optional().catch(undefined),
  sort: z.enum(LEASE_SORT_FIELDS).default(LEASE_LIST_DEFAULTS.sort).catch(LEASE_LIST_DEFAULTS.sort),
  direction: z.enum(['asc', 'desc']).default(LEASE_LIST_DEFAULTS.direction).catch(LEASE_LIST_DEFAULTS.direction),
  status: z.enum(LEASE_STATUSES).optional().catch(undefined),
  verification: z.enum(LEASE_VERIFICATION_FILTERS).optional().catch(undefined),
  propertyId: z.string().refine(isUuid).optional().catch(undefined),
  expiresWithinDays: z.coerce
    .number()
    .refine((days) => (EXPIRING_WITHIN_DAY_OPTIONS as readonly number[]).includes(days))
    .optional()
    .catch(undefined),
})

export type LeaseListSearch = z.output<typeof leaseListSearchSchema>

/** The API list params for the URL state: the verification filter becomes the API's `verified` boolean. */
export function leaseListParamsFrom({ verification, ...search }: LeaseListSearch): LeaseListParams {
  return {
    ...search,
    ...(verification === undefined ? {} : { verified: verification === 'verified' }),
  }
}
