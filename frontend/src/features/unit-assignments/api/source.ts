import type { UnitAssignmentSortField } from '@leaseguard/api-client'
import type { EntityId, UnitTenantAssignmentListItem } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { UnitAssignmentSortField }

/** Filters accepted by `GET /api/v1/unit-assignments`, each a single optional value. */
export interface UnitAssignmentListParams extends ListParams<UnitAssignmentSortField> {
  tenantId?: EntityId
  unitId?: EntityId
  propertyId?: EntityId
  /** true: current assignments only; false: ended ones only. */
  current?: boolean
}

/**
 * Where tenants assigned to units come from (ticket M4-04). The company is explicit; the database checks every rule
 * (who holds the unit, archived property, another company's records) and answers in words.
 */
export interface UnitAssignmentSource {
  list(companyId: EntityId, params: UnitAssignmentListParams): Promise<Page<UnitTenantAssignmentListItem>>
  /** Company admins and property managers. Rejects with 409 naming who holds the unit, 404 for another company's records. */
  assign(companyId: EntityId, assignment: { tenantId: EntityId; unitId: EntityId }): Promise<UnitTenantAssignmentListItem>
  /** Ends a current assignment (kept as history). Rejects with 409 when it has already ended. */
  end(companyId: EntityId, assignmentId: EntityId): Promise<UnitTenantAssignmentListItem>
}
