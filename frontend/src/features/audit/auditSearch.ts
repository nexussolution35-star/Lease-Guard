import { AUDIT_ACTIONS, compareISODate, ENTITY_TYPES, isValidISODate } from '@leaseguard/domain'
import { z } from 'zod'

import { isUuid } from '@/lib/data/ids'
import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

/** Audit log state left out of the URL when unchanged. */
export const AUDIT_DEFAULTS = { page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE } as const

const isoDay = z.string().refine(isValidISODate).optional().catch(undefined)

/**
 * `/settings/audit` search params. Invalid values fall back to "no filter" (or the default page), and
 * a range that ends before it starts drops its end, so a hand-edited address never produces a request
 * the API refuses.
 */
export const auditSearchSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(AUDIT_DEFAULTS.page).catch(AUDIT_DEFAULTS.page),
    pageSize: z.coerce.number().int().min(1).max(MAX_LIST_PAGE_SIZE).default(AUDIT_DEFAULTS.pageSize).catch(AUDIT_DEFAULTS.pageSize),
    action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
    entityType: z.enum(ENTITY_TYPES).optional().catch(undefined),
    actor: z.string().refine(isUuid).optional().catch(undefined),
    from: isoDay,
    to: isoDay,
  })
  .transform((search) => ({ ...search, to: search.from && search.to && compareISODate(search.from, search.to) > 0 ? undefined : search.to }))

export type AuditSearch = z.output<typeof auditSearchSchema>

/** The filters of an audit search, without paging. */
export type AuditFilters = Partial<Pick<AuditSearch, 'action' | 'entityType' | 'actor' | 'from' | 'to'>>

export function hasAuditFilters(search: AuditFilters): boolean {
  return Boolean(search.action || search.entityType || search.actor || search.from || search.to)
}
