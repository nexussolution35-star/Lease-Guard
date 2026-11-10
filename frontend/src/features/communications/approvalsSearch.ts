import { z } from 'zod'

import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

/** Approval queue state left out of the URL when unchanged. */
export const APPROVALS_DEFAULTS = { page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE } as const

/** `/communications/approvals` search params; invalid values fall back to defaults. */
export const approvalsSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(APPROVALS_DEFAULTS.page).catch(APPROVALS_DEFAULTS.page),
  pageSize: z.coerce.number().int().min(1).max(MAX_LIST_PAGE_SIZE).default(APPROVALS_DEFAULTS.pageSize).catch(APPROVALS_DEFAULTS.pageSize),
})

export type ApprovalsSearch = z.output<typeof approvalsSearchSchema>
