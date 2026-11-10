import type { EntityId, UserRole, WhatsAppHandover } from '@leaseguard/domain'
import { z } from 'zod'

import { isCompanyWriter } from '@/features/account/permissions'
import type { CompanyMember } from '@/features/users/api/source'

/** Members who can handle a conversation of `companyId`: active company admins and property managers. */
export function assignableMembers(members: readonly CompanyMember[], companyId: EntityId): CompanyMember[] {
  return members.filter(
    (member) => member.status === 'active' && member.memberships.some((m) => m.companyId === companyId && isCompanyWriter(m.role as UserRole)),
  )
}

/** One line on who handles a conversation, for the signed-in user `currentUserId`. */
export function handoverStatusText(handover: WhatsAppHandover, currentUserId: EntityId | null): string {
  const mine = handover.assignedUserId !== undefined && handover.assignedUserId === currentUserId
  const who = mine ? 'you' : (handover.assignedUserName ?? 'a colleague')
  if (handover.status === 'accepted') return `Taken over by ${who}`
  if (handover.assignedUserId) return mine ? 'Assigned to you; accept it to take the conversation over' : `Assigned to ${who}, waiting for them to accept`
  return handover.requestedBy === 'agent' ? 'The AI agent asked for a person' : 'Waiting for a person'
}

/** "5 h 12 min" / "12 min" / "less than a minute": time left in WhatsApp's customer service window. */
export function formatRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`
}

/** The most text WhatsApp takes in one message. */
export const REPLY_MAX_LENGTH = 4096

export const replyFormSchema = z.object({
  body: z
    .string()
    .max(REPLY_MAX_LENGTH, `A reply is at most ${REPLY_MAX_LENGTH} characters`)
    .refine((value) => value.trim() !== '', { message: 'Write a reply' }),
})
export type ReplyFormValues = z.infer<typeof replyFormSchema>
