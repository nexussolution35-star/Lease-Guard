import { describe, expect, it } from 'vitest'

import type { OccupancyUnitRow } from '../types/reports.js'
import { buildOccupancyReport, buildPortfolioOverview, occupancyFigures, type ArrearsAccount, type PropertyFigures } from './portfolioReports.js'

const property = (patch: Partial<PropertyFigures> & Pick<PropertyFigures, 'propertyId' | 'propertyName'>): PropertyFigures => ({
  code: patch.propertyName.slice(0, 3).toUpperCase(),
  status: 'active',
  unitCount: 0,
  occupiedUnits: 0,
  vacantUnits: 0,
  activeLeases: 0,
  unverifiedLeases: 0,
  monthlyRentalRoll: 0,
  openEvents: 0,
  ...patch,
})

const account = (tenantId: string, propertyId: string, outstanding: number, statementId = `${tenantId}-${propertyId}`): ArrearsAccount => ({
  tenantId,
  propertyId,
  statementId,
  statementDate: '2026-10-31',
  outstanding,
})

const PROPERTIES: PropertyFigures[] = [
  property({ propertyId: 'p1', propertyName: 'Maponya Square', unitCount: 4, occupiedUnits: 3, vacantUnits: 1, activeLeases: 2, unverifiedLeases: 1, monthlyRentalRoll: 21960.1, openEvents: 2 }),
  property({ propertyId: 'p2', propertyName: 'Westgate', status: 'under_development', unitCount: 2, occupiedUnits: 0, vacantUnits: 2 }),
  property({ propertyId: 'p3', propertyName: 'Old Mall', status: 'archived', unitCount: 5, occupiedUnits: 1, vacantUnits: 4 }),
]

describe('buildPortfolioOverview', () => {
  it('lists every property under management with its figures, and totals them as the dashboard does', () => {
    const accounts = [account('t1', 'p1', 1500.555), account('t2', 'p1', 0), account('t3', 'p1', -200), account('t1', 'p2', 100)]
    const report = buildPortfolioOverview(PROPERTIES, accounts)

    expect(report.properties.map((row) => row.propertyId)).toEqual(['p1', 'p2'])
    expect(report.properties[0]).toMatchObject({
      unitCount: 4,
      occupiedUnits: 3,
      vacantUnits: 1,
      occupancyRate: 0.75,
      activeLeases: 2,
      monthlyRentalRoll: 21960.1,
      outstanding: 1500.56,
      tenantsInArrears: 1,
      openEvents: 2,
    })
    expect(report).toMatchObject({
      propertyCount: 2,
      unitCount: 6,
      occupiedUnits: 3,
      vacantUnits: 3,
      occupancyRate: 0.5,
      activeLeases: 2,
      unverifiedLeases: 1,
      totalOutstanding: 1600.56,
      // t1 owes at two properties and counts once; a zero or credit balance is not arrears.
      tenantsInArrears: 1,
      openEvents: 2,
    })
  })

  it('keeps an archived property listed while it carries a balance or open events, without counting its units', () => {
    const report = buildPortfolioOverview(PROPERTIES, [account('t9', 'p3', 900)])
    expect(report.properties.map((row) => [row.propertyId, row.status])).toEqual([
      ['p1', 'active'],
      ['p2', 'under_development'],
      ['p3', 'archived'],
    ])
    expect(report.totalOutstanding).toBe(900)
    expect(report.propertyCount).toBe(2)
    expect(report.unitCount).toBe(6)

    const withEvents = buildPortfolioOverview(
      PROPERTIES.map((row) => (row.propertyId === 'p3' ? { ...row, openEvents: 1 } : row)),
      [],
    )
    expect(withEvents.properties.map((row) => row.propertyId)).toContain('p3')
    expect(withEvents.openEvents).toBe(3)
  })

  it('narrows to the filtered properties and property statuses', () => {
    const accounts = [account('t1', 'p1', 500), account('t2', 'p2', 300)]
    const one = buildPortfolioOverview(PROPERTIES, accounts, { propertyIds: ['p2'] })
    expect(one.properties.map((row) => row.propertyId)).toEqual(['p2'])
    expect(one).toMatchObject({ propertyCount: 1, unitCount: 2, totalOutstanding: 300, tenantsInArrears: 1 })

    const archived = buildPortfolioOverview(PROPERTIES, accounts, { statuses: ['archived'] })
    expect(archived.properties.map((row) => row.propertyId)).toEqual(['p3'])
    expect(archived).toMatchObject({ propertyCount: 0, unitCount: 0, occupancyRate: 0, totalOutstanding: 0 })
  })

  it('answers zeros for a company without properties', () => {
    expect(buildPortfolioOverview([], [])).toEqual({
      propertyCount: 0,
      unitCount: 0,
      occupiedUnits: 0,
      vacantUnits: 0,
      occupancyRate: 0,
      activeLeases: 0,
      unverifiedLeases: 0,
      monthlyRentalRoll: 0,
      totalOutstanding: 0,
      tenantsInArrears: 0,
      openEvents: 0,
      properties: [],
    })
  })
})

const unit = (patch: Partial<OccupancyUnitRow> & Pick<OccupancyUnitRow, 'unitId'>): OccupancyUnitRow => ({
  unitNumber: patch.unitId.toUpperCase(),
  unitType: 'line_shop',
  floorAreaSqm: 100,
  occupancyStatus: 'vacant',
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  ...patch,
})

const UNITS: OccupancyUnitRow[] = [
  unit({ unitId: 's1', occupancyStatus: 'occupied', floorAreaSqm: 120.25, tenantId: 't1', tenantName: 'Dlamini Cellular', tenantSource: 'lease', leaseId: 'l1', leaseReference: 'MSQ-L001' }),
  unit({ unitId: 's2', occupancyStatus: 'occupied', unitType: 'restaurant', floorAreaSqm: 200, tenantId: 't2', tenantName: 'Kasi Flame Grill', tenantSource: 'assignment' }),
  unit({ unitId: 's3', occupancyStatus: 'under_offer', floorAreaSqm: 80 }),
  unit({ unitId: 'w1', propertyId: 'p2', propertyName: 'Westgate', unitType: 'office_suite', occupancyStatus: 'unavailable', floorAreaSqm: 300 }),
  unit({ unitId: 'w2', propertyId: 'p2', propertyName: 'Westgate', occupancyStatus: 'vacant', floorAreaSqm: 50 }),
]

describe('occupancyFigures', () => {
  it('counts every occupancy status, the rate and the floor areas', () => {
    expect(occupancyFigures(UNITS)).toEqual({
      total: 5,
      occupied: 2,
      vacant: 1,
      underOffer: 1,
      unavailable: 1,
      occupancyRate: 0.4,
      floorAreaSqm: 750.25,
      occupiedAreaSqm: 320.25,
    })
    expect(occupancyFigures([]).occupancyRate).toBe(0)
  })
})

describe('buildOccupancyReport', () => {
  it('totals the units by property and by unit type, keeping each unit with its current tenant', () => {
    const report = buildOccupancyReport(UNITS)
    expect(report.totals.total).toBe(5)
    expect(report.byProperty.map((row) => [row.propertyName, row.total, row.occupied])).toEqual([
      ['Maponya Square', 3, 2],
      ['Westgate', 2, 0],
    ])
    // In UNIT_TYPES order; types without units are left out.
    expect(report.byUnitType.map((row) => [row.unitType, row.total])).toEqual([
      ['line_shop', 3],
      ['restaurant', 1],
      ['office_suite', 1],
    ])
    expect(report.units.find((row) => row.unitId === 's2')).toMatchObject({ tenantName: 'Kasi Flame Grill', tenantSource: 'assignment' })
  })

  it('narrows to the filtered properties and occupancy statuses', () => {
    const report = buildOccupancyReport(UNITS, { propertyIds: ['p1'], statuses: ['occupied'] })
    expect(report.units.map((row) => row.unitId)).toEqual(['s1', 's2'])
    expect(report.totals).toMatchObject({ total: 2, occupied: 2, occupancyRate: 1 })
    expect(report.byProperty).toHaveLength(1)
  })
})
