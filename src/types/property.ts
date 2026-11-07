import type { Address, CompanyScoped, EntityId } from './common'

export const PROPERTY_TYPES = [
  'shopping_centre',
  'retail',
  'office',
  'industrial_warehouse',
  'mixed_use',
] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export const PROPERTY_STATUSES = ['active', 'under_development', 'archived'] as const
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number]

export interface Property extends CompanyScoped {
  name: string
  /** Short code used in lease references, e.g. `MSQ`. */
  code: string
  type: PropertyType
  address: Address
  description: string
  status: PropertyStatus
  /** Gross lettable area in square metres. */
  grossLettableAreaSqm: number
  /** Property manager responsible for this property. */
  managerUserId: EntityId
  /** Property owner receiving weekly WhatsApp summaries. */
  ownerUserId?: EntityId
  /** Primary accounting system that generates statements for this property. */
  accountingSystem: 'MRI' | 'MDA' | 'PropSys' | 'Sage' | 'other'
}
