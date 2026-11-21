import type { EntityId, ISODate, ZAR } from '../types/common.js'
import type { PropertyStatus } from '../types/property.js'
import type {
  OccupancyFigures,
  OccupancyReport,
  OccupancyUnitRow,
  PortfolioOverviewReport,
  PortfolioPropertyRow,
  ReportFilters,
} from '../types/reports.js'
import { UNIT_TYPES } from '../types/unit.js'
import { roundZar, sumZar } from './money.js'
import { inReportProperties, inReportStatuses } from './reportFrame.js'

/**
 * The portfolio overview and occupancy reports (ticket R-01, PRD §7, §12.9), put together from the rows the database
 * returns (supabase/migrations/*_reports_portfolio_occupancy.sql), counted the way the dashboard counts them:
 * properties and units of properties that are not archived, occupied = occupancy status `occupied`, active leases =
 * status `active`, and the outstanding balance of each account on its latest verified statement (an arrangement never
 * takes a balance out). Pure: the caller supplies the rows.
 */

/** One property's figures, as `reports_property_figures` returns them. */
export interface PropertyFigures {
  propertyId: EntityId
  propertyName: string
  code: string
  status: PropertyStatus
  unitCount: number
  occupiedUnits: number
  vacantUnits: number
  activeLeases: number
  unverifiedLeases: number
  monthlyRentalRoll: ZAR
  openEvents: number
}

/** One account's latest verified statement, as `reports_arrears_accounts` returns it (zero and credit included). */
export interface ArrearsAccount {
  tenantId: EntityId
  propertyId: EntityId
  unitId?: EntityId
  leaseId?: EntityId
  statementId: EntityId
  statementDate: ISODate
  outstanding: ZAR
}

/** Share of `part` in `whole` (0–1), 0 when there is nothing to share. */
function rateOf(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

/**
 * Which properties the overview lists. With a status filter: the properties of those statuses. Without one: every
 * property that is not archived, and an archived property only while it still carries an outstanding balance or open
 * events, so a balance on record never drops out of the total.
 */
function isListed(row: PortfolioPropertyRow, filters: ReportFilters): boolean {
  if (!inReportProperties(filters, row.propertyId)) return false
  if (filters.statuses && filters.statuses.length > 0) return inReportStatuses(filters, row.status)
  return row.status !== 'archived' || row.outstanding > 0 || row.openEvents > 0
}

export function buildPortfolioOverview(
  properties: readonly PropertyFigures[],
  accounts: readonly ArrearsAccount[],
  filters: ReportFilters = {},
): PortfolioOverviewReport {
  const inArrears = accounts.filter((account) => account.outstanding > 0)
  const accountsAt = new Map<EntityId, ArrearsAccount[]>()
  for (const account of inArrears) accountsAt.set(account.propertyId, [...(accountsAt.get(account.propertyId) ?? []), account])

  const rows: PortfolioPropertyRow[] = properties
    .map((property): PortfolioPropertyRow => {
      const owing = accountsAt.get(property.propertyId) ?? []
      return {
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        code: property.code,
        status: property.status,
        unitCount: property.unitCount,
        occupiedUnits: property.occupiedUnits,
        vacantUnits: property.vacantUnits,
        occupancyRate: rateOf(property.occupiedUnits, property.unitCount),
        activeLeases: property.activeLeases,
        monthlyRentalRoll: roundZar(property.monthlyRentalRoll),
        outstanding: sumZar(owing.map((account) => account.outstanding)),
        tenantsInArrears: new Set(owing.map((account) => account.tenantId)).size,
        openEvents: property.openEvents,
      }
    })
    .filter((row) => isListed(row, filters))

  const listed = new Set(rows.map((row) => row.propertyId))
  const managed = rows.filter((row) => row.status !== 'archived')
  const unverifiedByProperty = new Map(properties.map((property) => [property.propertyId, property.unverifiedLeases]))
  const unitCount = managed.reduce((total, row) => total + row.unitCount, 0)
  const occupiedUnits = managed.reduce((total, row) => total + row.occupiedUnits, 0)

  return {
    propertyCount: managed.length,
    unitCount,
    occupiedUnits,
    vacantUnits: managed.reduce((total, row) => total + row.vacantUnits, 0),
    occupancyRate: rateOf(occupiedUnits, unitCount),
    activeLeases: rows.reduce((total, row) => total + row.activeLeases, 0),
    unverifiedLeases: rows.reduce((total, row) => total + (unverifiedByProperty.get(row.propertyId) ?? 0), 0),
    monthlyRentalRoll: sumZar(rows.map((row) => row.monthlyRentalRoll)),
    totalOutstanding: sumZar(rows.map((row) => row.outstanding)),
    tenantsInArrears: new Set(inArrears.filter((account) => listed.has(account.propertyId)).map((account) => account.tenantId)).size,
    openEvents: rows.reduce((total, row) => total + row.openEvents, 0),
    properties: rows,
  }
}

/** Occupancy figures of a set of units. */
export function occupancyFigures(units: readonly OccupancyUnitRow[]): OccupancyFigures {
  const count = (status: OccupancyUnitRow['occupancyStatus']) => units.filter((unit) => unit.occupancyStatus === status).length
  const occupied = count('occupied')
  const area = (list: readonly OccupancyUnitRow[]) => Math.round(list.reduce((total, unit) => total + unit.floorAreaSqm, 0) * 100) / 100
  return {
    total: units.length,
    occupied,
    vacant: count('vacant'),
    underOffer: count('under_offer'),
    unavailable: count('unavailable'),
    occupancyRate: rateOf(occupied, units.length),
    floorAreaSqm: area(units),
    occupiedAreaSqm: area(units.filter((unit) => unit.occupancyStatus === 'occupied')),
  }
}

/**
 * The occupancy report of the units `reports_unit_occupancy` returns (properties that are not archived), narrowed to
 * the filtered properties and occupancy statuses: totals, by property (in the units' order) and by unit type (in the
 * order of UNIT_TYPES, types without units left out), and the units themselves with their current tenant.
 */
export function buildOccupancyReport(units: readonly OccupancyUnitRow[], filters: ReportFilters = {}): OccupancyReport {
  const shown = units.filter((unit) => inReportProperties(filters, unit.propertyId) && inReportStatuses(filters, unit.occupancyStatus))

  const byPropertyId = new Map<EntityId, { propertyName: string; units: OccupancyUnitRow[] }>()
  for (const unit of shown) {
    const group = byPropertyId.get(unit.propertyId) ?? { propertyName: unit.propertyName, units: [] }
    group.units.push(unit)
    byPropertyId.set(unit.propertyId, group)
  }

  return {
    totals: occupancyFigures(shown),
    byProperty: [...byPropertyId].map(([propertyId, group]) => ({ propertyId, propertyName: group.propertyName, ...occupancyFigures(group.units) })),
    byUnitType: UNIT_TYPES.map((unitType) => ({ unitType, units: shown.filter((unit) => unit.unitType === unitType) }))
      .filter((group) => group.units.length > 0)
      .map(({ unitType, units: ofType }) => ({ unitType, ...occupancyFigures(ofType) })),
    units: shown,
  }
}
