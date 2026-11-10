import { z } from 'zod'

import { pageQuerySchema } from '../../common/http/pagination'

/** Inbox views besides everything: conversations with an unresolved handover, or those assigned to the caller. */
export const CONVERSATION_FILTERS = ['handed_over', 'mine'] as const
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number]

/** The inbox: most recent conversation first; optionally one receiving number, or a handover view. */
export const conversationListQuerySchema = pageQuerySchema.omit({ search: true, direction: true }).extend({
  numberId: z.uuid().optional(),
  filter: z.enum(CONVERSATION_FILTERS).optional(),
})
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>

/** How many of a conversation's latest messages the thread shows. */
export const THREAD_MESSAGE_LIMIT = 200

/** POST …/handover/assign. */
export const assignHandoverBodySchema = z.strictObject({ userId: z.uuid() })
export type AssignHandoverBody = z.infer<typeof assignHandoverBodySchema>

/** POST …/handover/resolve. */
export const resolveHandoverBodySchema = z.strictObject({ note: z.string().trim().max(1000).optional() })
export type ResolveHandoverBody = z.infer<typeof resolveHandoverBodySchema>

/** POST …/replies: free text WhatsApp accepts in one message. */
export const replyBodySchema = z.strictObject({
  body: z.string().max(4096).refine((value) => value.trim() !== '', { message: 'Write a reply' }),
})
export type ReplyBody = z.infer<typeof replyBodySchema>
