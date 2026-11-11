import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Communication, CommunicationAnalytics } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import { getCommunicationSource } from './selectSource'
import type { ApprovalDecisionResult, ApprovalQueueParams, CommunicationAnalyticsParams, CommunicationListParams, PendingApproval } from './source'

export const communicationKeys = createEntityKeys('communications')

/** The approval queue, under the communications prefix so a decision refreshes it with every message list. */
export const approvalQueueKeys = {
  list: (companyId: EntityId, params: ApprovalQueueParams) => [...communicationKeys.company(companyId), 'approvals', params] as const,
}

/** Communication analytics, under the communications prefix so a decision or a new message refreshes them too. */
export const communicationAnalyticsKeys = {
  range: (companyId: EntityId, params: CommunicationAnalyticsParams) => [...communicationKeys.company(companyId), 'analytics', params] as const,
}

/** The active workspace's WhatsApp figures over the range (the last 30 days without dates). */
export function useCommunicationAnalytics(params: CommunicationAnalyticsParams, options: { enabled?: boolean } = {}): UseQueryResult<CommunicationAnalytics> {
  return useCompanyQuery(
    (companyId) => communicationAnalyticsKeys.range(companyId, params),
    (companyId) => getCommunicationSource().analytics(companyId, params),
    { keepPrevious: true, enabled: options.enabled ?? true },
  )
}

export function useCommunicationList(params: CommunicationListParams): UseQueryResult<Page<Communication>> {
  return useCompanyQuery(
    (companyId) => communicationKeys.list(companyId, params),
    (companyId) => getCommunicationSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useCommunicationQuery(id: EntityId): UseQueryResult<Communication | null> {
  return useCompanyQuery(
    (companyId) => communicationKeys.detail(companyId, id),
    (companyId) => getCommunicationSource().get(companyId, id),
  )
}

/** Messages awaiting approval in the active workspace, oldest request first. */
export function usePendingApprovals(params: ApprovalQueueParams): UseQueryResult<Page<PendingApproval>> {
  return useCompanyQuery(
    (companyId) => approvalQueueKeys.list(companyId, params),
    (companyId) => getCommunicationSource().listPendingApprovals(companyId, params),
    { keepPrevious: true },
  )
}

/** A decision on a message awaiting approval; refreshes the queue and every message list afterwards. */
function useDecision<TVariables>(
  run: (companyId: EntityId, variables: TVariables) => Promise<ApprovalDecisionResult>,
): UseMutationResult<ApprovalDecisionResult, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyId()
  return useMutation({
    mutationFn: (variables: TVariables) => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return run(companyId, variables)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: communicationKeys.all }),
  })
}

/** Company writers: approve a message and queue it for delivery (422 lists every deliverability blocker). */
export function useApproveCommunication(): UseMutationResult<ApprovalDecisionResult, Error, { communicationId: EntityId; note?: string }> {
  return useDecision((companyId, { communicationId, note }: { communicationId: EntityId; note?: string }) =>
    getCommunicationSource().approve(companyId, communicationId, note),
  )
}

/** Company writers: reject a message with a reason; it is never sent. */
export function useRejectCommunication(): UseMutationResult<ApprovalDecisionResult, Error, { communicationId: EntityId; reason: string }> {
  return useDecision((companyId, { communicationId, reason }: { communicationId: EntityId; reason: string }) =>
    getCommunicationSource().reject(companyId, communicationId, reason),
  )
}
