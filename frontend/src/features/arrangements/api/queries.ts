import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, PaymentArrangementListItem } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getArrangementSource } from './selectSource'
import type {
  ArrangementCancellation,
  ArrangementChanges,
  ArrangementClosing,
  ArrangementListParams,
  InstallmentOutcomeRecord,
  NewArrangement,
} from './source'

export const arrangementKeys = createEntityKeys('paymentArrangements')

export function useArrangementList(params: ArrangementListParams): UseQueryResult<Page<PaymentArrangementListItem>> {
  return useCompanyQuery(
    (companyId) => arrangementKeys.list(companyId, params),
    (companyId) => getArrangementSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useArrangementQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<PaymentArrangementListItem | null> {
  return useCompanyQuery(
    (companyId) => arrangementKeys.detail(companyId, id),
    (companyId) => getArrangementSource().get(companyId, id),
    options,
  )
}

/**
 * One arrangement write: stores the returned arrangement in its detail cache, then refreshes every arrangement list
 * and detail of the company, and the statements arrears summary (it marks tenants under an arrangement).
 */
function useArrangementMutation<TVariables>(
  run: (companyId: EntityId, variables: TVariables) => Promise<PaymentArrangementListItem>,
): UseMutationResult<PaymentArrangementListItem, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSuccess: (arrangement) => queryClient.setQueryData(arrangementKeys.detail(arrangement.companyId, arrangement.id), arrangement),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: arrangementKeys.all }),
        queryClient.invalidateQueries({ queryKey: [...createEntityKeys('statements').company(companyId()), 'arrears'] }),
      ])
    },
  })
}

/** Records a payment arrangement in the active workspace (company admins and property managers). */
export function useCreateArrangement(): UseMutationResult<PaymentArrangementListItem, Error, NewArrangement> {
  return useArrangementMutation((companyId, arrangement: NewArrangement) => getArrangementSource().create(companyId, arrangement))
}

/** Edits a proposed or active arrangement; changed terms regenerate its schedule. */
export function useUpdateArrangement(): UseMutationResult<PaymentArrangementListItem, Error, { id: EntityId; changes: ArrangementChanges }> {
  return useArrangementMutation((companyId, { id, changes }: { id: EntityId; changes: ArrangementChanges }) =>
    getArrangementSource().update(companyId, id, changes),
  )
}

/** Closes an active arrangement as completed or defaulted. */
export function useCloseArrangement(): UseMutationResult<PaymentArrangementListItem, Error, { id: EntityId; closing: ArrangementClosing }> {
  return useArrangementMutation((companyId, { id, closing }: { id: EntityId; closing: ArrangementClosing }) =>
    getArrangementSource().close(companyId, id, closing),
  )
}

/** Cancels a proposed or active arrangement with the reason. */
export function useCancelArrangement(): UseMutationResult<PaymentArrangementListItem, Error, { id: EntityId; cancellation: ArrangementCancellation }> {
  return useArrangementMutation((companyId, { id, cancellation }: { id: EntityId; cancellation: ArrangementCancellation }) =>
    getArrangementSource().cancel(companyId, id, cancellation),
  )
}

/** Records what the property manager confirms happened to an instalment (paid, missed, waived), or clears it. */
export function useRecordInstallmentOutcome(): UseMutationResult<
  PaymentArrangementListItem,
  Error,
  { id: EntityId; installmentId: EntityId; outcome: InstallmentOutcomeRecord }
> {
  return useArrangementMutation(
    (companyId, { id, installmentId, outcome }: { id: EntityId; installmentId: EntityId; outcome: InstallmentOutcomeRecord }) =>
      getArrangementSource().recordInstallmentOutcome(companyId, id, installmentId, outcome),
  )
}
