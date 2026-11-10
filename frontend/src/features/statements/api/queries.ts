import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Statement } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getStatementSource } from './selectSource'
import type { StatementListParams } from './source'

export const statementKeys = createEntityKeys('statements')

export function useStatementList(params: StatementListParams): UseQueryResult<Page<Statement>> {
  return useCompanyQuery(
    (companyId) => statementKeys.list(companyId, params),
    (companyId) => getStatementSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useStatementQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<Statement | null> {
  return useCompanyQuery(
    (companyId) => statementKeys.detail(companyId, id),
    (companyId) => getStatementSource().get(companyId, id),
    options,
  )
}
