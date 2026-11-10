import { OCCUPANCY_STATUSES, UNIT_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const UNIT_SORT_FIELDS = ['unitNumber', 'floorAreaSqm', 'occupancyStatus', 'createdAt'] as const

export const unitListQuerySchema = listQuerySchema(UNIT_SORT_FIELDS, {
  propertyId: z.uuid().optional(),
  occupancyStatus: z.enum(OCCUPANCY_STATUSES).optional(),
  type: z.enum(UNIT_TYPES).optional(),
})
export type UnitListQuery = z.infer<typeof unitListQuerySchema>

/** API sort field → database column. */
export const UNIT_SORT_COLUMNS = {
  unitNumber: 'unit_number',
  floorAreaSqm: 'floor_area_sqm',
  occupancyStatus: 'occupancy_status',
  createdAt: 'created_at',
} as const satisfies Record<(typeof UNIT_SORT_FIELDS)[number], string>
