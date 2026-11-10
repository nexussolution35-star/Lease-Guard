import { z } from 'zod'

import { DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

/** Inbox state left out of the URL when unchanged. */
export const INBOX_DEFAULTS = { page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE } as const

/** `/whatsapp/conversations` search params; invalid values fall back to defaults. */
export const inboxSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(INBOX_DEFAULTS.page).catch(INBOX_DEFAULTS.page),
  pageSize: z.coerce.number().int().min(1).max(MAX_LIST_PAGE_SIZE).default(INBOX_DEFAULTS.pageSize).catch(INBOX_DEFAULTS.pageSize),
  conversation: z.uuid().optional().catch(undefined),
})

export type InboxSearch = z.output<typeof inboxSearchSchema>
