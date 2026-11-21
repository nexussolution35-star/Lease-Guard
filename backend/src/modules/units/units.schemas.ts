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

/** Text that can be cleared: '' or null clears it, omitted leaves it unchanged. */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

/** At most two decimals (numeric(12,2)). Compared after rounding: value * 100 is often not exact in floating point. */
const floorArea = z
  .number()
  .positive('must be more than 0')
  .max(1_000_000, 'must be at most 1 000 000 m²')
  .refine((value) => Math.round(value * 100) / 100 === value, { message: 'must have at most two decimals' })

const unitFields = {
  unitNumber: z
    .string()
    .trim()
    .max(30, 'must be at most 30 characters')
    .refine((value) => value !== '', { message: 'Enter the unit number' }),
  type: z.enum(UNIT_TYPES),
  floorAreaSqm: floorArea,
  floor: clearableText(50),
  occupancyStatus: z.enum(OCCUPANCY_STATUSES),
  description: clearableText(2000),
}

/**
 * Body of POST /units. The property is fixed once the unit exists (leases, statements and arrangements reference the
 * unit together with its property). The current tenant and lease are derived from the active lease, so neither is sent.
 */
export const createUnitBodySchema = z.strictObject({
  propertyId: z.uuid(),
  unitNumber: unitFields.unitNumber,
  type: unitFields.type,
  floorAreaSqm: unitFields.floorAreaSqm,
  floor: unitFields.floor,
  occupancyStatus: unitFields.occupancyStatus.optional(),
  description: unitFields.description,
})
export type CreateUnitBody = z.infer<typeof createUnitBodySchema>

/** Body of PATCH /units/:unitId: omitted fields are unchanged. */
export const updateUnitBodySchema = z
  .strictObject({
    unitNumber: unitFields.unitNumber.optional(),
    type: unitFields.type.optional(),
    floorAreaSqm: unitFields.floorAreaSqm.optional(),
    floor: unitFields.floor,
    occupancyStatus: unitFields.occupancyStatus.optional(),
    description: unitFields.description,
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Change at least one field' })
export type UpdateUnitBody = z.infer<typeof updateUnitBodySchema>
