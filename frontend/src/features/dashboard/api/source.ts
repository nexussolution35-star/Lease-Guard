import type { DashboardSummary, EntityId } from '@leaseguard/domain'

/**
 * Where the dashboard's figures come from: one summary the API calculates from the database (PRD §7.1). The screen
 * never counts or adds anything up itself.
 */
export interface DashboardSource {
  summary(companyId: EntityId): Promise<DashboardSummary>
}
