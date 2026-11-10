import type { EventCalculation, MonitoringEvent } from '@leaseguard/domain'

import type { Json, Tables } from '../../infrastructure/database/database.types'
import { eventCalculationSchema } from './monitoring.schemas'

export type MonitoringEventRow = Tables<'monitoring_events'>

/** `calculation` jsonb → domain `EventCalculation`. A malformed value is a data error, never dropped silently. */
function toCalculation(value: Json, eventId: string): EventCalculation {
  const parsed = eventCalculationSchema.safeParse(value)
  if (!parsed.success) throw new Error(`monitoring_events.calculation of ${eventId} is malformed: ${parsed.error.message}`)
  const { expectedAmount, actualAmount, difference, steps } = parsed.data
  return {
    ...(expectedAmount !== undefined ? { expectedAmount } : {}),
    ...(actualAmount !== undefined ? { actualAmount } : {}),
    ...(difference !== undefined ? { difference } : {}),
    steps,
  }
}

/** Database row → domain `MonitoringEvent`. Nullable columns become absent optional fields. */
export function toMonitoringEvent(row: MonitoringEventRow): MonitoringEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    propertyId: row.property_id,
    ...(row.unit_id ? { unitId: row.unit_id } : {}),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.lease_reference !== null ? { leaseReference: row.lease_reference } : {}),
    ...(row.statement_id ? { statementId: row.statement_id } : {}),
    ...(row.arrangement_id ? { arrangementId: row.arrangement_id } : {}),
    ...(row.rule_id ? { ruleId: row.rule_id } : {}),
    title: row.title,
    description: row.description,
    ...(row.calculation !== null ? { calculation: toCalculation(row.calculation, row.id) } : {}),
    identifiedOn: row.identified_on,
    ...(row.due_date ? { dueDate: row.due_date } : {}),
    priority: row.priority,
    recommendedAction: row.recommended_action,
    ...(row.assigned_to_user_id ? { assignedToUserId: row.assigned_to_user_id } : {}),
    status: row.status,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    ...(row.resolved_by_user_id ? { resolvedByUserId: row.resolved_by_user_id } : {}),
    ...(row.resolution_notes !== null ? { resolutionNotes: row.resolution_notes } : {}),
    // The database guarantees all three dismissal columns are set exactly when the event is dismissed.
    ...(row.dismissal_reason !== null && row.dismissed_by_user_id && row.dismissed_at
      ? { dismissal: { reason: row.dismissal_reason, dismissedByUserId: row.dismissed_by_user_id, dismissedAt: row.dismissed_at } }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
