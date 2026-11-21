import { OCCUPANCY_STATUSES, UNIT_TYPES, type Unit } from '@leaseguard/domain'
import { z } from 'zod'

import type { NewUnit, UnitChanges } from './api/source'

const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`)

/**
 * The unit form (create and edit), with the API's rules. The property is chosen once, on create: leases, statements
 * and arrangements reference the unit together with its property. The tenant and lease are never typed in; they come
 * from the active lease.
 */
export const unitFormSchema = z.object({
  propertyId: z.string().min(1, 'Choose the property'),
  unitNumber: z.string().trim().min(1, 'Enter the unit number').max(30, 'Use at most 30 characters'),
  type: z.enum(UNIT_TYPES, { error: 'Choose a unit type' }),
  floorAreaSqm: z
    .number({ error: 'Enter the floor area' })
    .positive('The area must be more than 0 m²')
    .max(1_000_000, 'Use at most 1 000 000 m²')
    .refine((value) => Math.round(value * 100) / 100 === value, { message: 'Use at most two decimals' }),
  floor: optional(50),
  occupancyStatus: z.enum(OCCUPANCY_STATUSES, { error: 'Choose the occupancy' }),
  description: optional(2000),
})

export type UnitFormInput = z.input<typeof unitFormSchema>
export type UnitFormValues = z.output<typeof unitFormSchema>
export type UnitFormField = keyof UnitFormValues

/** Empty form for a new unit, in the given property when it is known. A new unit is vacant unless chosen otherwise. */
export function newUnitFormDefaults(propertyId: string | undefined): UnitFormInput {
  return {
    propertyId: propertyId ?? '',
    unitNumber: '',
    type: '' as UnitFormInput['type'],
    floorAreaSqm: undefined as unknown as number,
    floor: '',
    occupancyStatus: 'vacant',
    description: '',
  }
}

/** Form values for an existing unit. */
export function unitFormDefaults(unit: Unit): UnitFormInput {
  return {
    propertyId: unit.propertyId,
    unitNumber: unit.unitNumber,
    type: unit.type,
    floorAreaSqm: unit.floorAreaSqm,
    floor: unit.floor ?? '',
    occupancyStatus: unit.occupancyStatus,
    description: unit.description ?? '',
  }
}

/** The `POST /units` body. Empty optional text is left out. */
export function newUnitFrom(values: UnitFormValues): NewUnit {
  return {
    propertyId: values.propertyId,
    unitNumber: values.unitNumber,
    type: values.type,
    floorAreaSqm: values.floorAreaSqm,
    occupancyStatus: values.occupancyStatus,
    ...(values.floor === '' ? {} : { floor: values.floor }),
    ...(values.description === '' ? {} : { description: values.description }),
  }
}

/**
 * The `PATCH /units/{id}` body for the fields that differ from the saved unit, or null when nothing changed. The
 * property is never sent; emptied floor or description sends null, which clears it.
 */
export function unitChangesFrom(values: UnitFormValues, unit: Unit): UnitChanges | null {
  const saved = unitFormSchema.safeParse(unitFormDefaults(unit))
  const before: Partial<UnitFormValues> = saved.success ? saved.data : {}
  const changed = (field: UnitFormField) => values[field] !== before[field]

  const changes: UnitChanges = {}
  if (changed('unitNumber')) changes.unitNumber = values.unitNumber
  if (changed('type')) changes.type = values.type
  if (changed('floorAreaSqm')) changes.floorAreaSqm = values.floorAreaSqm
  if (changed('floor')) changes.floor = values.floor === '' ? null : values.floor
  if (changed('occupancyStatus')) changes.occupancyStatus = values.occupancyStatus
  if (changed('description')) changes.description = values.description === '' ? null : values.description
  return Object.keys(changes).length > 0 ? changes : null
}

/**
 * Where an API refusal belongs in the form: a taken unit number (409) on the unit number, a property that is not in
 * the workspace (422) on the property, a leased unit that must stay occupied (422) on the occupancy; anything else
 * (such as an archived property) is shown above the form.
 */
export function unitErrorField(status: number, message: string): UnitFormField | null {
  if (status === 409) return 'unitNumber'
  if (status === 422 && /occupied/i.test(message)) return 'occupancyStatus'
  if (status === 422 && /choose a property/i.test(message)) return 'propertyId'
  return null
}
