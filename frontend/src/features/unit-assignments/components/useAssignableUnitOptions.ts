import {
  canChooseUnitForAssignment,
  describeUnitAssignmentAvailability,
  unitAssignmentAvailability,
  type EntityId,
} from '@leaseguard/domain'

import type { FieldOption } from '@/components/forms'
import { usePropertyList } from '@/features/properties/api/queries'
import { useUnitList } from '@/features/units/api/queries'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

const listAll = { page: 1, pageSize: MAX_LIST_PAGE_SIZE } as const

/**
 * The property, then unit, choice for assigning a tenant: the workspace's properties that are not archived, and the
 * chosen property's units. A unit that cannot be assigned to the tenant (domain `unitAssignmentAvailability`: let to
 * or assigned to another tenant, or already the tenant's) stays listed but cannot be chosen, and says who holds it.
 * The database decides; this only explains the choice before it is sent.
 */
export function useAssignableUnitOptions(propertyId: EntityId | undefined, tenantId: EntityId | undefined) {
  const properties = usePropertyList({ ...listAll, sort: 'name', direction: 'asc' })
  const units = useUnitList({ ...listAll, sort: 'unitNumber', direction: 'asc', ...(propertyId ? { propertyId } : {}) })

  const propertyOptions: FieldOption[] = (properties.data?.items ?? [])
    .filter((property) => property.status !== 'archived')
    .map((property) => ({ value: property.id, label: property.name }))

  const property = properties.data?.items.find((candidate) => candidate.id === propertyId)
  const unitOptions: FieldOption[] = propertyId
    ? (units.data?.items ?? [])
        .filter((unit) => unit.propertyId === propertyId)
        .map((unit) => {
          const availability = unitAssignmentAvailability(unit, tenantId, property?.status)
          const reason = describeUnitAssignmentAvailability(availability)
          return {
            value: unit.id,
            label: `${unit.unitNumber} · ${reason ?? labelFor(unit.occupancyStatus)}`,
            ...(canChooseUnitForAssignment(availability) ? {} : { disabled: true }),
          }
        })
    : []

  return {
    propertyOptions,
    unitOptions,
    propertiesPending: properties.isPending,
    unitsPending: propertyId !== undefined && units.isPending,
  }
}
