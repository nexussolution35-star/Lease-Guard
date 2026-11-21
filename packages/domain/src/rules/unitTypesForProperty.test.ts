import { describe, expect, it } from 'vitest'

import { PROPERTY_TYPES } from '../types/property.js'
import { UNIT_TYPES } from '../types/unit.js'
import { unitTypeMatchesProperty, unitTypesForProperty } from './unitTypesForProperty.js'

describe('unitTypesForProperty', () => {
  it('suggests office suites first for an office building and never shops', () => {
    expect(unitTypesForProperty('office')[0]).toBe('office_suite')
    expect(unitTypeMatchesProperty('line_shop', 'office')).toBe(false)
  })

  it('suggests line shops first for a shopping centre and warehouses first for an industrial property', () => {
    expect(unitTypesForProperty('shopping_centre')[0]).toBe('line_shop')
    expect(unitTypesForProperty('industrial_warehouse')[0]).toBe('warehouse')
    expect(unitTypeMatchesProperty('yard', 'retail')).toBe(false)
  })

  it('allows every unit type in a mixed-use property and before a property type is chosen', () => {
    expect(unitTypesForProperty('mixed_use')).toEqual(UNIT_TYPES)
    expect(unitTypesForProperty(undefined)).toEqual(UNIT_TYPES)
  })

  it('offers at least one valid unit type for every property type', () => {
    for (const type of PROPERTY_TYPES) {
      const types = unitTypesForProperty(type)
      expect(types.length).toBeGreaterThan(0)
      expect(types.every((t) => UNIT_TYPES.includes(t))).toBe(true)
    }
  })
})
