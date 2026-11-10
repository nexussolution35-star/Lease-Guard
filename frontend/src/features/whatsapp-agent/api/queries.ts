import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import { getAgentSource } from './selectSource'
import type {
  AgentSource,
  KnowledgeDocument,
  KnowledgeDocumentUpload,
  KnowledgeEntry,
  KnowledgeFaq,
  KnowledgeKind,
  KnowledgeTextInput,
  KnowledgeTextKind,
  WhatsAppAgentConfig,
  WhatsAppAgentConfigInput,
} from './source'

export const agentConfigKeys = createEntityKeys('whatsapp-agent-config')
export const knowledgeKeys = createEntityKeys('whatsapp-knowledge')

/** The active company's AI agent configuration (defaults until an admin saves one). */
export function useAgentConfig(): UseQueryResult<WhatsAppAgentConfig> {
  return useCompanyQuery((companyId) => agentConfigKeys.company(companyId), (companyId) => getAgentSource().getConfig(companyId))
}

export function useKnowledgeFaqs(): UseQueryResult<KnowledgeFaq[]> {
  return useCompanyQuery((companyId) => knowledgeKeys.list(companyId, { kind: 'faq' }), (companyId) => getAgentSource().listFaqs(companyId))
}

export function useKnowledgeEntries(): UseQueryResult<KnowledgeEntry[]> {
  return useCompanyQuery((companyId) => knowledgeKeys.list(companyId, { kind: 'entry' }), (companyId) => getAgentSource().listEntries(companyId))
}

export function useKnowledgeDocuments(): UseQueryResult<KnowledgeDocument[]> {
  return useCompanyQuery((companyId) => knowledgeKeys.list(companyId, { kind: 'document' }), (companyId) => getAgentSource().listDocuments(companyId))
}

/** A mutation for the active company that refreshes `keys` afterwards. */
function useAgentMutation<TVariables, TResult>(
  keys: readonly unknown[],
  run: (source: AgentSource, companyId: EntityId, variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyId()
  return useMutation({
    mutationFn: (variables: TVariables) => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return run(getAgentSource(), companyId, variables)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys }),
  })
}

/** Company admins: save the whole configuration. */
export function useSaveAgentConfig(): UseMutationResult<WhatsAppAgentConfig, Error, WhatsAppAgentConfigInput> {
  return useAgentMutation(agentConfigKeys.all, (source, companyId, input: WhatsAppAgentConfigInput) => source.saveConfig(companyId, input))
}

/** Company admins: add (no id) or change an FAQ or entry. */
export function useSaveKnowledgeText(): UseMutationResult<KnowledgeFaq | KnowledgeEntry, Error, { kind: KnowledgeTextKind; id?: EntityId; input: KnowledgeTextInput }> {
  return useAgentMutation(knowledgeKeys.all, (source, companyId, { kind, id, input }: { kind: KnowledgeTextKind; id?: EntityId; input: KnowledgeTextInput }) =>
    id === undefined ? source.createText(companyId, kind, input) : source.updateText(companyId, kind, id, input),
  )
}

/** Company admins: upload a document as a draft. */
export function useUploadKnowledgeDocument(): UseMutationResult<KnowledgeDocument, Error, KnowledgeDocumentUpload> {
  return useAgentMutation(knowledgeKeys.all, (source, companyId, upload: KnowledgeDocumentUpload) => source.uploadDocument(companyId, upload))
}

/** Company admins: approve or return to draft. */
export function useReviewKnowledge(): UseMutationResult<void, Error, { kind: KnowledgeKind; id: EntityId; action: 'approve' | 'withdraw' }> {
  return useAgentMutation(knowledgeKeys.all, (source, companyId, { kind, id, action }: { kind: KnowledgeKind; id: EntityId; action: 'approve' | 'withdraw' }) =>
    source.review(companyId, kind, id, action),
  )
}

/** Company admins: delete an item (a document with its file). */
export function useDeleteKnowledge(): UseMutationResult<void, Error, { kind: KnowledgeKind; id: EntityId }> {
  return useAgentMutation(knowledgeKeys.all, (source, companyId, { kind, id }: { kind: KnowledgeKind; id: EntityId }) => source.remove(companyId, kind, id))
}

/** A five-minute link to a document's file (nothing to refresh afterwards). */
export function useKnowledgeDocumentLink(): UseMutationResult<string, Error, { id: EntityId }> {
  const companyId = useActiveCompanyId()
  return useMutation({
    mutationFn: ({ id }: { id: EntityId }) => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return getAgentSource().documentDownloadUrl(companyId, id)
    },
  })
}
