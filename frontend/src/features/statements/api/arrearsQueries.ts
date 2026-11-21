import type { UseQueryResult } from '@tanstack/react-query'
import type { StatementArrearsSummary } from '@leaseguard/domain'

import { lazySource } from '@/lib/data/dataSource'
import { useCompanyQuery } from '@/lib/data/queries'
import { getApiClient } from '@/services/api/client'

import { createApiStatementArrearsSource, type StatementArrearsSource } from './arrearsSource'
import { statementKeys } from './queries'

/** The arrears source: the LeaseGuard API, created on first use. */
export const getStatementArrearsSource: () => StatementArrearsSource = lazySource(() => createApiStatementArrearsSource(getApiClient()))

/** Under the statements prefix, so anything that refreshes statements (verifying, retrying) refreshes these figures too. */
export const statementArrearsKey = (companyId: string) => [...statementKeys.company(companyId), 'arrears'] as const

/** Outstanding balances and arrears ageing from verified statements, for the active workspace. */
export function useStatementArrears(): UseQueryResult<StatementArrearsSummary> {
  return useCompanyQuery(statementArrearsKey, (companyId) => getStatementArrearsSource().summary(companyId))
}
