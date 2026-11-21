import type { PropertyType } from '../types/property.js'
import { UNIT_TYPES, type UnitType } from '../types/unit.js'

/**
 * The unit types that suit each property type, most usual first. The first entry is the default for a new unit.
 * A mixed-use property can hold any unit type.
 */
const UNIT_TYPES_BY_PROPERTY_TYPE: Record<PropertyType, readonly UnitType[]> = {
  shopping_centre: ['line_shop', 'anchor_retail', 'kiosk', 'restaurant', 'storage', 'parking'],
  retail: ['line_shop', 'anchor_retail', 'kiosk', 'restaurant', 'storage', 'parking'],
  office: ['office_suite', 'storage', 'parking'],
  industrial_warehouse: ['warehouse', 'yard', 'office_suite', 'storage', 'parking'],
  mixed_use: UNIT_TYPES,
}

/** Unit types that match `propertyType`; every unit type while the property type is not chosen yet. */
export function unitTypesForProperty(propertyType: PropertyType | undefined): readonly UnitType[] {
  return propertyType ? UNIT_TYPES_BY_PROPERTY_TYPE[propertyType] : UNIT_TYPES
}

/** True when a unit of `unitType` belongs in a property of `propertyType`. */
export function unitTypeMatchesProperty(unitType: UnitType, propertyType: PropertyType | undefined): boolean {
  return unitTypesForProperty(propertyType).includes(unitType)
}
