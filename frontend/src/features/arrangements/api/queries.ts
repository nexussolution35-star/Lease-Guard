import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, PaymentArrangement } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getArrangementSource } from './selectSource'
import type { ArrangementListParams } from './source'

export const arrangementKeys = createEntityKeys('paymentArrangements')

export function useArrangementList(params: ArrangementListParams): UseQueryResult<Page<PaymentArrangement>> {
  return useCompanyQuery(
    (companyId) => arrangementKeys.list(companyId, params),
    (companyId) => getArrangementSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useArrangementQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<PaymentArrangement | null> {
  return useCompanyQuery(
    (companyId) => arrangementKeys.detail(companyId, id),
    (companyId) => getArrangementSource().get(companyId, id),
    options,
  )
}
