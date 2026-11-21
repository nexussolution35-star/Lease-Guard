import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import {
  OCCUPANCY_STATUSES,
  PROPERTY_STATUSES,
  UNIT_TENANT_SOURCES,
  UNIT_TYPES,
  type ArrearsAccount,
  type EntityId,
  type OccupancyUnitRow,
  type PropertyFigures,
} from '@leaseguard/domain'
import { httpErrorFromDatabase, type DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

/** PostgREST returns numeric and bigint columns as JSON numbers (or strings for very large values). */
const figure = z.coerce.number().refine(Number.isFinite)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().transform((value) => value ?? undefined)

const propertyFiguresRow = z
  .object({
    property_id: z.string(),
    property_name: z.string(),
    property_code: z.string(),
    property_status: z.enum(PROPERTY_STATUSES),
    unit_count: figure,
    occupied_units: figure,
    vacant_units: figure,
    active_leases: figure,
    unverified_leases: figure,
    monthly_rental_roll: figure,
    open_events: figure,
  })
  .transform(
    (row): PropertyFigures => ({
      propertyId: row.property_id,
      propertyName: row.property_name,
      code: row.property_code,
      status: row.property_status,
      unitCount: row.unit_count,
      occupiedUnits: row.occupied_units,
      vacantUnits: row.vacant_units,
      activeLeases: row.active_leases,
      unverifiedLeases: row.unverified_leases,
      monthlyRentalRoll: row.monthly_rental_roll,
      openEvents: row.open_events,
    }),
  )

const arrearsAccountRow = z
  .object({
    tenant_id: z.string(),
    property_id: z.string(),
    unit_id: optional(z.string()),
    lease_id: optional(z.string()),
    statement_id: z.string(),
    statement_date: z.string(),
    outstanding: figure,
  })
  .transform(
    (row): ArrearsAccount => ({
      tenantId: row.tenant_id,
      propertyId: row.property_id,
      ...(row.unit_id ? { unitId: row.unit_id } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      statementId: row.statement_id,
      statementDate: row.statement_date,
      outstanding: row.outstanding,
    }),
  )

const unitOccupancyRow = z
  .object({
    unit_id: z.string(),
    unit_number: z.string(),
    unit_type: z.enum(UNIT_TYPES),
    floor_area_sqm: figure,
    occupancy_status: z.enum(OCCUPANCY_STATUSES),
    property_id: z.string(),
    property_name: z.string(),
    tenant_id: optional(z.string()),
    tenant_name: optional(z.string()),
    tenant_source: optional(z.enum(UNIT_TENANT_SOURCES)),
    lease_id: optional(z.string()),
    lease_reference: optional(z.string()),
  })
  .transform(
    (row): OccupancyUnitRow => ({
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      unitType: row.unit_type,
      floorAreaSqm: row.floor_area_sqm,
      occupancyStatus: row.occupancy_status,
      propertyId: row.property_id,
      propertyName: row.property_name,
      ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
      ...(row.tenant_name ? { tenantName: row.tenant_name } : {}),
      ...(row.tenant_source ? { tenantSource: row.tenant_source } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      ...(row.lease_reference ? { leaseReference: row.lease_reference } : {}),
    }),
  )

const logger = new Logger('ReportData')

/**
 * The company data the reports read, through the read-only reporting functions granted to `authenticated`
 * (supabase/migrations/*_reports_*.sql, ADR 0003). Every call runs with the caller's own token, so Row Level Security
 * applies; a function refuses (42501, here 403) a company the caller is not a member of. Rows are validated, so a
 * changed function fails loudly instead of producing wrong figures.
 */
@Injectable()
export class ReportDataService {
  propertyFigures(db: DbClient, companyId: EntityId): Promise<PropertyFigures[]> {
    return this.rows(db, 'reports_property_figures', companyId, propertyFiguresRow, 'Read the property figures')
  }

  arrearsAccounts(db: DbClient, companyId: EntityId): Promise<ArrearsAccount[]> {
    return this.rows(db, 'reports_arrears_accounts', companyId, arrearsAccountRow, 'Read the outstanding balances')
  }

  unitOccupancy(db: DbClient, companyId: EntityId): Promise<OccupancyUnitRow[]> {
    return this.rows(db, 'reports_unit_occupancy', companyId, unitOccupancyRow, 'Read the unit occupancy')
  }

  private async rows<S extends z.ZodType>(db: DbClient, fn: string, companyId: EntityId, row: S, operation: string): Promise<z.output<S>[]> {
    const { data, error } = await db.rpc(fn, { p_company_id: companyId })
    if (error) throw httpErrorFromDatabase(error, operation)
    const parsed = z.array(row).safeParse(data ?? [])
    if (!parsed.success) {
      logger.error(`${operation}: ${fn} returned rows of an unexpected shape: ${parsed.error.message}`)
      throw new InternalServerErrorException('An unexpected error occurred')
    }
    return parsed.data
  }
}
