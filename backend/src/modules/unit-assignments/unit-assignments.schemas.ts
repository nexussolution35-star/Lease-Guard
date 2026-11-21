import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const UNIT_ASSIGNMENT_SORT_FIELDS = ['assignedAt'] as const

/** Query-string boolean: only the literals `true` and `false` are accepted. */
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true')

export const unitAssignmentListQuerySchema = listQuerySchema(UNIT_ASSIGNMENT_SORT_FIELDS, {
  tenantId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  propertyId: z.uuid().optional(),
  /** true: only current assignments; false: only ended ones; omitted: both. */
  current: queryBoolean.optional(),
})
export type UnitAssignmentListQuery = z.infer<typeof unitAssignmentListQuerySchema>

/** API sort field → database column. */
export const UNIT_ASSIGNMENT_SORT_COLUMNS = {
  assignedAt: 'assigned_at',
} as const satisfies Record<(typeof UNIT_ASSIGNMENT_SORT_FIELDS)[number], string>

/** Body of POST /unit-assignments: the tenant and the unit. The property is the unit's. */
export const createUnitAssignmentBodySchema = z.strictObject({
  tenantId: z.uuid(),
  unitId: z.uuid(),
})
export type CreateUnitAssignmentBody = z.infer<typeof createUnitAssignmentBodySchema>
