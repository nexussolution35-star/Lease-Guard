import { TEMPLATED_MESSAGE_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

/** Path parameter: a message type sent with a template (the five tenant types and the owner types). */
export const templatedMessageTypeSchema = z.enum(TEMPLATED_MESSAGE_TYPES)

/** Body of PUT /message-templates/{messageType}: the synced Meta template that now sends the type. */
export const chooseMessageTemplateBodySchema = z.strictObject({
  whatsappTemplateId: z.uuid(),
})
export type ChooseMessageTemplateBody = z.infer<typeof chooseMessageTemplateBodySchema>
