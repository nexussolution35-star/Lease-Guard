import { useMemo } from 'react'

import type { EntityId, Unit } from '@leaseguard/domain'

import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository } from '@/services/repository'

export const unitsRepo = createRepository('units', {
  entityType: 'unit',
  label: 'Unit',
  idPrefix: 'unit',
  searchFields: ['unitNumber', 'description', 'floor'],
})

export const listUnits = unitsRepo.list
export const listAllUnits = unitsRepo.listAll
export const getUnit = unitsRepo.getById
export const createUnit = unitsRepo.create
export const updateUnit = unitsRepo.update
export const removeUnit = unitsRepo.remove

export function listUnitsForProperty(propertyId: EntityId): Unit[] {
  return unitsRepo.listAll().filter((u) => u.propertyId === propertyId)
}

/** Mark a unit occupied by the given tenant/lease, keeping the denormalised fields consistent. */
export function assignTenant(unitId: EntityId, tenantId: EntityId, leaseId: EntityId): Unit {
  return unitsRepo.update(
    unitId,
    { occupancyStatus: 'occupied', currentTenantId: tenantId, currentLeaseId: leaseId },
    { summary: `Unit assigned to tenant ${tenantId}` },
  )
}

/** Mark a unit vacant and clear the denormalised tenant/lease pointers. */
export function releaseUnit(unitId: EntityId): Unit {
  return unitsRepo.update(
    unitId,
    { occupancyStatus: 'vacant', currentTenantId: undefined, currentLeaseId: undefined },
    { summary: 'Unit released (vacant)' },
  )
}

// Hooks --------------------------------------------------------------------

export function useUnits(query?: ListQuery<Unit>): PagedResult<Unit> {
  return unitsRepo.useList(query)
}

export const useAllUnits = unitsRepo.useAll
export const useUnit = unitsRepo.useById

export function useUnitsForProperty(propertyId: EntityId | undefined): Unit[] {
  const all = unitsRepo.useAll()
  return useMemo(() => (propertyId ? all.filter((u) => u.propertyId === propertyId) : []), [all, propertyId])
}
