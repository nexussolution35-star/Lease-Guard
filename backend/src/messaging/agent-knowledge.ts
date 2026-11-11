import { AGENT_LANGUAGES, AGENT_PERMITTED_ACTIONS, type EntityId, KNOWLEDGE_DOCUMENT_MIME_TYPES, WEEKDAYS } from '@leaseguard/domain'
import { z } from 'zod'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../infrastructure/database/database.types'
import { MessagingReadError } from './read-error'

// The same type as the API's and the worker's DbClient, spelled out so the module depends only on the schema types (as
// communication-lifecycle.ts), which lets the integration tests drive it against local Postgres.
type DbClient = SupabaseClient<Database>

/**
 * What one company's AI agent may know (ticket 09; used by the agent runtime, ticket 10): its configuration, the
 * handover contacts who are still active admins or property managers, and its APPROVED FAQs, knowledge entries and
 * documents. It is read through public.whatsapp_agent_knowledge(company), which never returns drafts or another
 * company's rows, so a prompt built from it holds only that company's approved information. The worker calls it with
 * its service-role client (the function is not executable by signed-in users).
 */
const agentKnowledgeSchema = z.object({
  companyId: z.uuid(),
  config: z
    .object({
      agentName: z.string(),
      businessDescription: z.string(),
      tone: z.string(),
      timezone: z.string(),
      operatingHours: z.array(z.object({ day: z.enum(WEEKDAYS), opens: z.string(), closes: z.string() })),
      languages: z.array(z.enum(AGENT_LANGUAGES)),
      policies: z.string(),
      supportInstructions: z.string(),
      escalationRules: z.string(),
      permittedActions: z.array(z.enum(AGENT_PERMITTED_ACTIONS)),
      autoReplyEnabled: z.boolean(),
      outOfHoursMessage: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  handoverContactUserIds: z.array(z.uuid()),
  faqs: z.array(z.object({ id: z.uuid(), question: z.string(), answer: z.string() })),
  entries: z.array(z.object({ id: z.uuid(), title: z.string(), content: z.string() })),
  documents: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      description: z.string().nullable(),
      fileName: z.string(),
      storagePath: z.string(),
      mimeType: z.enum(KNOWLEDGE_DOCUMENT_MIME_TYPES),
    }),
  ),
})

export type AgentKnowledge = z.infer<typeof agentKnowledgeSchema>

/** The company's agent configuration and approved knowledge. Throws MessagingReadError when the read fails. */
export async function loadAgentKnowledge(db: DbClient, companyId: EntityId): Promise<AgentKnowledge> {
  const { data, error } = await db.rpc('whatsapp_agent_knowledge', { p_company_id: companyId })
  if (error) throw new MessagingReadError('Load agent knowledge', error)
  const knowledge = agentKnowledgeSchema.parse(data)
  if (knowledge.companyId !== companyId) throw new Error('whatsapp_agent_knowledge answered for another company')
  return knowledge
}
