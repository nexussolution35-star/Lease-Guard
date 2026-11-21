import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import {
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  EVENT_PRIORITIES,
  LEASE_STATUSES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  type EntityId,
  type EscalationTolerance,
  type EventCalculation,
  type MonitoringReportEvent,
  type RentalComparisonLease,
} from '@leaseguard/domain'
import { httpErrorFromDatabase, type DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

/** PostgREST returns numeric columns as JSON numbers (or strings for very large values). */
const figure = z.coerce.number().refine(Number.isFinite)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().transform((value) => value ?? undefined)

/** monitoring_events.calculation (EventCalculation); a calculation of another shape is left out rather than guessed. */
const calculationJson = z.object({
  expectedAmount: figure.optional(),
  actualAmount: figure.optional(),
  difference: figure.optional(),
  steps: z.array(z.string()),
})

const monitoringEventRow = z
  .object({
    event_id: z.string(),
    event_type: z.enum(MONITORING_EVENT_TYPES),
    title: z.string(),
    priority: z.enum(EVENT_PRIORITIES),
    status: z.enum(MONITORING_EVENT_STATUSES),
    property_id: z.string(),
    property_name: z.string(),
    unit_number: optional(z.string()),
    tenant_id: optional(z.string()),
    tenant_name: optional(z.string()),
    lease_id: optional(z.string()),
    lease_reference: optional(z.string()),
    statement_id: optional(z.string()),
    statement_date: optional(z.string()),
    statement_period_start: optional(z.string()),
    identified_on: z.string(),
    due_date: optional(z.string()),
    calculation: z.unknown(),
  })
  .transform((row): MonitoringReportEvent => {
    const calculation = calculationJson.safeParse(row.calculation)
    return {
      eventId: row.event_id,
      type: row.event_type,
      title: row.title,
      priority: row.priority,
      status: row.status,
      propertyId: row.property_id,
      propertyName: row.property_name,
      ...(row.unit_number ? { unitNumber: row.unit_number } : {}),
      ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
      ...(row.tenant_name ? { tenantName: row.tenant_name } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      ...(row.lease_reference ? { leaseReference: row.lease_reference } : {}),
      ...(row.statement_id ? { statementId: row.statement_id } : {}),
      ...(row.statement_date ? { statementDate: row.statement_date } : {}),
      ...(row.statement_period_start ? { periodStart: row.statement_period_start } : {}),
      identifiedOn: row.identified_on,
      ...(row.due_date ? { dueDate: row.due_date } : {}),
      ...(calculation.success ? { calculation: withoutUndefined(calculation.data) } : {}),
    }
  })

function withoutUndefined(calculation: z.output<typeof calculationJson>): EventCalculation {
  return {
    ...(calculation.expectedAmount !== undefined ? { expectedAmount: calculation.expectedAmount } : {}),
    ...(calculation.actualAmount !== undefined ? { actualAmount: calculation.actualAmount } : {}),
    ...(calculation.difference !== undefined ? { difference: calculation.difference } : {}),
    steps: calculation.steps,
  }
}

const rentalComparisonRow = z
  .object({
    lease_id: z.string(),
    lease_reference: z.string(),
    lease_status: z.enum(LEASE_STATUSES),
    verified: z.boolean(),
    property_id: z.string(),
    property_name: z.string(),
    unit_number: optional(z.string()),
    tenant_id: z.string(),
    tenant_name: z.string(),
    commencement_date: z.string(),
    expiry_date: z.string(),
    initial_monthly_rental: figure,
    escalation_type: z.enum(ESCALATION_TYPES),
    escalation_percentage: optional(figure),
    escalation_fixed_amount: optional(figure),
    escalation_cpi_assumed_percentage: optional(figure),
    escalation_cpi_margin_percentage: optional(figure),
    escalation_frequency: z.enum(ESCALATION_FREQUENCIES),
    first_escalation_date: z.string(),
    statement_id: optional(z.string()),
    statement_date: optional(z.string()),
    period_start: optional(z.string()),
    rental_charged: optional(figure),
  })
  .transform(
    (row): RentalComparisonLease => ({
      leaseId: row.lease_id,
      reference: row.lease_reference,
      status: row.lease_status,
      verified: row.verified,
      propertyId: row.property_id,
      propertyName: row.property_name,
      ...(row.unit_number ? { unitNumber: row.unit_number } : {}),
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      commencementDate: row.commencement_date,
      expiryDate: row.expiry_date,
      initialMonthlyRental: row.initial_monthly_rental,
      // The same mapping as the core's lease rows (backend lease-rows.ts): only SQL NULL is absent.
      escalation: {
        type: row.escalation_type,
        ...(row.escalation_percentage !== undefined ? { percentage: row.escalation_percentage } : {}),
        ...(row.escalation_fixed_amount !== undefined ? { fixedAmount: row.escalation_fixed_amount } : {}),
        ...(row.escalation_cpi_assumed_percentage !== undefined ? { cpiAssumedPercentage: row.escalation_cpi_assumed_percentage } : {}),
        ...(row.escalation_cpi_margin_percentage !== undefined ? { cpiMarginPercentage: row.escalation_cpi_margin_percentage } : {}),
        frequency: row.escalation_frequency,
        firstEscalationDate: row.first_escalation_date,
      },
      ...(row.statement_id && row.statement_date && row.period_start && row.rental_charged !== undefined
        ? { billed: { statementId: row.statement_id, statementDate: row.statement_date, periodStart: row.period_start, rentalCharged: row.rental_charged } }
        : {}),
    }),
  )

const discrepancyRuleRow = z.object({ enabled: z.boolean(), config: z.unknown() })

/** monitoring_rules.config of the rental escalation discrepancy rule, as the core's monitoring settings read it. */
const discrepancyConfig = z.object({
  kind: z.literal('rental_escalation_discrepancy'),
  toleranceRands: z.number().nonnegative(),
  tolerancePercent: z.number().nonnegative(),
})

const logger = new Logger('MonitoringReportData')

/**
 * The company data of the lease monitoring and rental discrepancy reports (ticket R-02), through the read-only
 * reporting functions of supabase/migrations/20261122053000_reports_monitoring_discrepancies.sql, with the caller's own
 * token (Row Level Security applies; another company is refused, 403). Rows are validated, so a changed function fails
 * loudly instead of producing wrong figures.
 */
@Injectable()
export class MonitoringReportDataService {
  monitoringEvents(db: DbClient, companyId: EntityId): Promise<MonitoringReportEvent[]> {
    return this.rows(db, 'reports_monitoring_events', companyId, monitoringEventRow, 'Read the monitoring events')
  }

  rentalComparisons(db: DbClient, companyId: EntityId): Promise<RentalComparisonLease[]> {
    return this.rows(db, 'reports_rental_comparisons', companyId, rentalComparisonRow, 'Read the leases and billed rentals')
  }

  /**
   * The company's rental escalation discrepancy tolerance. Without the rule, or with a config that does not parse,
   * none (an exact comparison), as the lease monitoring scan falls back.
   */
  async discrepancyTolerance(db: DbClient, companyId: EntityId): Promise<EscalationTolerance> {
    const [rule] = await this.rows(db, 'reports_discrepancy_rule', companyId, discrepancyRuleRow, 'Read the rental discrepancy rule')
    const config = discrepancyConfig.safeParse(rule?.config)
    if (rule && !config.success) logger.warn({ companyId }, 'Ignoring an invalid rental escalation discrepancy rule config')
    return config.success ? { toleranceRands: config.data.toleranceRands, tolerancePercent: config.data.tolerancePercent } : { toleranceRands: 0, tolerancePercent: 0 }
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
