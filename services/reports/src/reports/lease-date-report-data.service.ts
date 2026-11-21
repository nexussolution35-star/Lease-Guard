import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { LEASE_STATUSES, type EntityId, type LeaseDateMonitoringSettings, type LeaseDateRecord } from '@leaseguard/domain'
import { httpErrorFromDatabase, type DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

/** PostgREST returns numeric columns as JSON numbers (or strings for very large values). */
const figure = z.coerce.number().refine(Number.isFinite)
const days = z.array(z.number().int()).nullable()

const leaseDateRow = z
  .object({
    lease_id: z.string(),
    lease_reference: z.string(),
    lease_status: z.enum(LEASE_STATUSES),
    verified: z.boolean(),
    tenant_id: z.string(),
    tenant_name: z.string(),
    property_id: z.string(),
    property_name: z.string(),
    unit_id: z.string(),
    unit_number: z.string(),
    expiry_date: z.string(),
    current_monthly_rental: figure,
    renewal_option_exists: z.boolean(),
    renewal_exercised: z.boolean(),
    renewal_notice_period_months: z.number().int().nullable(),
    open_expiry_event_id: z.string().nullable(),
    open_renewal_event_id: z.string().nullable(),
  })
  .transform(
    (row): LeaseDateRecord => ({
      leaseId: row.lease_id,
      reference: row.lease_reference,
      status: row.lease_status,
      verified: row.verified,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      propertyId: row.property_id,
      propertyName: row.property_name,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      expiryDate: row.expiry_date,
      currentMonthlyRental: row.current_monthly_rental,
      renewalOption: {
        exists: row.renewal_option_exists,
        exercised: row.renewal_exercised,
        ...(row.renewal_notice_period_months !== null ? { noticePeriodMonths: row.renewal_notice_period_months } : {}),
      },
      ...(row.open_expiry_event_id ? { openExpiryEventId: row.open_expiry_event_id } : {}),
      ...(row.open_renewal_event_id ? { openRenewalEventId: row.open_renewal_event_id } : {}),
    }),
  )

const settingsRow = z
  .object({ lease_expiry_notice_days: days, renewal_warning_days: days })
  .transform((row): LeaseDateMonitoringSettings => ({ leaseExpiryNoticeDays: row.lease_expiry_notice_days, renewalWarningDays: row.renewal_warning_days }))

const logger = new Logger('LeaseDateReportData')

/**
 * The company data the lease expiry and renewal deadline reports read, through the read-only reporting functions of
 * supabase/migrations/*_reports_lease_dates.sql (ADR 0003). Every call runs with the caller's own token, so Row Level
 * Security applies; a function refuses (42501, here 403) a company the caller is not a member of. Rows are validated,
 * so a changed function fails loudly instead of producing wrong figures.
 */
@Injectable()
export class LeaseDateReportDataService {
  /** Every lease of the company that has not ended, verified or not. */
  async leaseDates(db: DbClient, companyId: EntityId): Promise<LeaseDateRecord[]> {
    return this.read(db, 'reports_lease_dates', companyId, z.array(leaseDateRow), 'Read the lease dates')
  }

  /** The thresholds monitoring applies to lease expiry and renewal deadlines for the company. */
  async settings(db: DbClient, companyId: EntityId): Promise<LeaseDateMonitoringSettings> {
    // One row for a company the caller is a member of; the tuple schema refuses anything else.
    const [settings] = await this.read(db, 'reports_lease_date_settings', companyId, z.tuple([settingsRow]), 'Read the monitoring thresholds')
    return settings
  }

  private async read<S extends z.ZodType>(db: DbClient, fn: string, companyId: EntityId, schema: S, operation: string): Promise<z.output<S>> {
    const { data, error } = await db.rpc(fn, { p_company_id: companyId })
    if (error) throw httpErrorFromDatabase(error, operation)
    const parsed = schema.safeParse(data ?? [])
    if (!parsed.success) {
      logger.error(`${operation}: ${fn} returned rows of an unexpected shape: ${parsed.error.message}`)
      throw new InternalServerErrorException('An unexpected error occurred')
    }
    return parsed.data
  }
}
