import { useMemo } from 'react'

import { sumZar } from '@leaseguard/domain'
import { useAppStore } from '@/store/appStore'
import type { EntityId, Lease, Property, Unit, ZAR } from '@leaseguard/domain'

import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository } from '@/services/repository'

export const propertiesRepo = createRepository('properties', {
  entityType: 'property',
  label: 'Property',
  idPrefix: 'prop',
  searchFields: ['name', 'code', 'description'],
  archive: { field: 'status', value: 'archived' },
})

export const listProperties = propertiesRepo.list
export const listAllProperties = propertiesRepo.listAll
export const getProperty = propertiesRepo.getById
export const createProperty = propertiesRepo.create
export const updateProperty = propertiesRepo.update

/**
 * Archive a property. Only the property's own status changes; units, leases and tenants are
 * left untouched so history stays intact.
 */
export function archiveProperty(id: EntityId): Property {
  const archived = propertiesRepo.archive(id)
  if (!archived) throw new Error(`Property ${id} could not be archived`)
  return archived
}

export interface PropertyStats {
  unitCount: number
  occupiedCount: number
  vacantCount: number
  /** 0–1 */
  occupancyRate: number
  totalFloorAreaSqm: number
  activeLeaseCount: number
  /** Sum of current monthly rental across active/expiring leases (ZAR, excl. VAT). */
  monthlyRentalRoll: ZAR
}

export interface PropertyWithStats {
  property: Property
  stats: PropertyStats
}

export function computePropertyStats(
  propertyId: EntityId,
  units: readonly Unit[],
  leases: readonly Lease[],
): PropertyStats {
  const propertyUnits = units.filter((u) => u.propertyId === propertyId)
  const occupiedCount = propertyUnits.filter((u) => u.occupancyStatus === 'occupied').length
  const vacantCount = propertyUnits.filter((u) => u.occupancyStatus === 'vacant').length
  const activeLeases = leases.filter(
    (l) => l.propertyId === propertyId && (l.status === 'active' || l.status === 'expiring'),
  )
  const monthlyRentalRoll = sumZar(activeLeases.map((l) => l.currentMonthlyRental))
  return {
    unitCount: propertyUnits.length,
    occupiedCount,
    vacantCount,
    occupancyRate: propertyUnits.length === 0 ? 0 : occupiedCount / propertyUnits.length,
    totalFloorAreaSqm: propertyUnits.reduce((sum, u) => sum + u.floorAreaSqm, 0),
    activeLeaseCount: activeLeases.length,
    monthlyRentalRoll,
  }
}

export function getPropertyWithStats(id: EntityId): PropertyWithStats | undefined {
  const property = propertiesRepo.getById(id)
  if (!property) return undefined
  const { collections } = useAppStore.getState()
  const units = Object.values(collections.units).filter((u) => u.companyId === property.companyId)
  const leases = Object.values(collections.leases).filter((l) => l.companyId === property.companyId)
  return { property, stats: computePropertyStats(id, units, leases) }
}

// Hooks --------------------------------------------------------------------

export function useProperties(query?: ListQuery<Property>): PagedResult<Property> {
  return propertiesRepo.useList(query)
}

export const useAllProperties = propertiesRepo.useAll
export const useProperty = propertiesRepo.useById

export function usePropertyWithStats(id: EntityId | undefined): PropertyWithStats | undefined {
  const property = propertiesRepo.useById(id)
  const units = useAppStore((s) => s.collections.units)
  const leases = useAppStore((s) => s.collections.leases)
  return useMemo(() => {
    if (!property) return undefined
    const scopedUnits = Object.values(units).filter((u) => u.companyId === property.companyId)
    const scopedLeases = Object.values(leases).filter((l) => l.companyId === property.companyId)
    return { property, stats: computePropertyStats(property.id, scopedUnits, scopedLeases) }
  }, [property, units, leases])
}

/** Every property of the active workspace with its stats, for portfolio tables. */
export function usePropertiesWithStats(): PropertyWithStats[] {
  const properties = propertiesRepo.useAll()
  const units = useAppStore((s) => s.collections.units)
  const leases = useAppStore((s) => s.collections.leases)
  return useMemo(() => {
    const unitList = Object.values(units)
    const leaseList = Object.values(leases)
    return properties.map((property) => ({
      property,
      stats: computePropertyStats(property.id, unitList, leaseList),
    }))
  }, [properties, units, leases])
}
