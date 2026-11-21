import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'
import { isAgeingBucketLabel, type AgeingBucketLabel, type EntityId, type StatementArrearsSummary } from '@leaseguard/domain'

/**
 * Where the Statements page's arrears figures come from. The figures are calculated by the API (domain
 * `arrearsOverview`) from each tenant's latest verified statement; the screen never adds anything up itself.
 */
export interface StatementArrearsSource {
  summary(companyId: EntityId): Promise<StatementArrearsSummary>
}

/** The API types bucket labels as strings; anything else than a bucket label is a contract error, not a figure to show. */
function bucketLabel(value: string): AgeingBucketLabel {
  if (!isAgeingBucketLabel(value)) throw new Error(`Unexpected ageing bucket "${value}"`)
  return value
}

/** Arrears figures from the LeaseGuard API (`GET /api/v1/statements/arrears`). */
export function createApiStatementArrearsSource(api: ApiClient): StatementArrearsSource {
  return {
    async summary(companyId) {
      const summary = await unwrap(api.GET('/api/v1/statements/arrears', { headers: { [COMPANY_ID_HEADER]: companyId } }))
      return {
        ...summary,
        buckets: summary.buckets.map((item) => ({ ...item, bucket: bucketLabel(item.bucket) })),
        entries: summary.entries.map((entry) => ({ ...entry, bucket: bucketLabel(entry.bucket) })),
      }
    },
  }
}
