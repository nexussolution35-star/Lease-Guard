import {
  AGENT_LANGUAGES,
  AGENT_PERMITTED_ACTIONS,
  isClockTime,
  KNOWLEDGE_DOCUMENT_MAX_BYTES,
  KNOWLEDGE_DOCUMENT_MIME_TYPES,
  MAX_OPERATING_PERIODS,
  operatingHoursProblems,
  WEEKDAYS,
} from '@leaseguard/domain'
import { z } from 'zod'

/** A required text: trimmed, not blank. */
const requiredText = (max: number, blank: string) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value !== '', { message: blank })

const optionalText = (max: number) => z.string().trim().max(max)

/** An IANA time zone the runtime knows, e.g. `Africa/Johannesburg`. */
const timezoneSchema = z
  .string()
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-ZA', { timeZone: value })
        return /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value)
      } catch {
        return false
      }
    },
    { message: 'Use a time zone such as Africa/Johannesburg' },
  )

export const operatingPeriodSchema = z.strictObject({
  day: z.enum(WEEKDAYS),
  opens: z.string().refine((value) => isClockTime(value), { message: 'Use a 24-hour time such as 08:00' }),
  closes: z.string().refine((value) => isClockTime(value, { closing: true }), { message: 'Use a 24-hour time such as 17:00' }),
})

/** PUT /whatsapp/agent: the whole configuration. */
export const saveAgentConfigBodySchema = z.strictObject({
  agentName: requiredText(80, 'Give the agent a name'),
  businessDescription: optionalText(4000),
  tone: optionalText(500),
  timezone: timezoneSchema,
  operatingHours: z
    .array(operatingPeriodSchema)
    .max(MAX_OPERATING_PERIODS)
    .superRefine((periods, ctx) => {
      for (const problem of operatingHoursProblems(periods)) ctx.addIssue({ code: 'custom', message: problem })
    }),
  languages: z.array(z.enum(AGENT_LANGUAGES)).min(1, 'Choose at least one language').max(AGENT_LANGUAGES.length),
  policies: optionalText(8000),
  supportInstructions: optionalText(8000),
  escalationRules: optionalText(8000),
  permittedActions: z.array(z.enum(AGENT_PERMITTED_ACTIONS)).max(AGENT_PERMITTED_ACTIONS.length),
  autoReplyEnabled: z.boolean(),
  outOfHoursMessage: optionalText(1000).optional(),
  handoverContactUserIds: z.array(z.uuid()).max(20),
})
export type SaveAgentConfigBody = z.infer<typeof saveAgentConfigBodySchema>

/** POST /whatsapp/agent/faqs. */
export const createFaqBodySchema = z.strictObject({
  question: requiredText(500, 'Write the question'),
  answer: requiredText(4000, 'Write the answer'),
})
export type CreateFaqBody = z.infer<typeof createFaqBodySchema>

/** PATCH /whatsapp/agent/faqs/:id: changing an approved FAQ makes it a draft again. */
export const updateFaqBodySchema = createFaqBodySchema.partial().refine((body) => Object.keys(body).length > 0, { message: 'Change at least one field' })
export type UpdateFaqBody = z.infer<typeof updateFaqBodySchema>

/** POST /whatsapp/agent/knowledge-entries. */
export const createEntryBodySchema = z.strictObject({
  title: requiredText(200, 'Give the entry a title'),
  content: requiredText(10000, 'Write the entry'),
})
export type CreateEntryBody = z.infer<typeof createEntryBodySchema>

/** PATCH /whatsapp/agent/knowledge-entries/:id. */
export const updateEntryBodySchema = createEntryBodySchema.partial().refine((body) => Object.keys(body).length > 0, { message: 'Change at least one field' })
export type UpdateEntryBody = z.infer<typeof updateEntryBodySchema>

/** POST /whatsapp/agent/documents/upload-url. */
export const createDocumentUploadUrlBodySchema = z.strictObject({
  fileName: requiredText(255, 'Name the file'),
  mimeType: z.enum(KNOWLEDGE_DOCUMENT_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(KNOWLEDGE_DOCUMENT_MAX_BYTES, 'The file is larger than 10 MB'),
})
export type CreateDocumentUploadUrlBody = z.infer<typeof createDocumentUploadUrlBodySchema>

/** POST /whatsapp/agent/documents: register an uploaded file as a draft document. */
export const registerDocumentBodySchema = createDocumentUploadUrlBodySchema.extend({
  storagePath: z.string().min(1).max(400),
  title: requiredText(200, 'Give the document a title'),
  description: optionalText(1000).optional(),
})
export type RegisterDocumentBody = z.infer<typeof registerDocumentBodySchema>

/** PATCH /whatsapp/agent/documents/:id: title and description only (a new file is a new document). */
export const updateDocumentBodySchema = z
  .strictObject({ title: requiredText(200, 'Give the document a title').optional(), description: optionalText(1000).optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'Change at least one field' })
export type UpdateDocumentBody = z.infer<typeof updateDocumentBodySchema>
