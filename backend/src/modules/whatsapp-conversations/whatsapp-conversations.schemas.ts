import { z } from 'zod'

import { pageQuerySchema } from '../../common/http/pagination'

/** The inbox: most recent conversation first; optionally one receiving number. */
export const conversationListQuerySchema = pageQuerySchema.omit({ search: true, direction: true }).extend({
  numberId: z.uuid().optional(),
})
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>

/** How many of a conversation's latest messages the thread shows. */
export const THREAD_MESSAGE_LIMIT = 200
