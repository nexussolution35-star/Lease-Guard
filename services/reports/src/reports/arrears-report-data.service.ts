import { Injectable, Logger } from '@nestjs/common'
import {
  ARRANGEMENT_STATUSES,
  DEFAULT_AGEING_BUCKETS,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_STATUSES,
  type ArrearsReportAccount,
  type EntityId,
  type ReportArrangement,
} from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

import { ReportDataService } from './report-data.service'

/** PostgREST returns numeric columns as JSON numbers (or strings for very large values). */
const figure = z.coerce.number().refine(Number.isFinite)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().transform((value) => value ?? undefined)

const arrearsDetailRow = z
  .object({
    tenant_id: z.string(),
    tenant_name: z.string(),
    property_id: z.string(),
    property_name: z.string(),
    unit_id: optional(z.string()),
    unit_number: optional(z.string()),
    lease_id: optional(z.string()),
    lease_reference: optional(z.string()),
    statement_id: z.string(),
    statement_date: z.string(),
    outstanding: figure,
  })
  .transform(
    (row): ArrearsReportAccount => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      propertyId: row.property_id,
      propertyName: row.property_name,
      ...(row.unit_id ? { unitId: row.unit_id } : {}),
      ...(row.unit_number ? { unitNumber: row.unit_number } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      ...(row.lease_reference ? { leaseReference: row.lease_reference } : {}),
      statementId: row.statement_id,
      statementDate: row.statement_date,
      outstanding: row.outstanding,
    }),
  )

const installmentJson = z.object({
  id: z.string(),
  sequence: figure,
  dueDate: z.string(),
  amount: figure,
  status: z.enum(INSTALLMENT_STATUSES),
})

const arrangementRow = z
  .object({
    arrangement_id: z.string(),
    tenant_id: z.string(),
    tenant_name: z.string(),
    property_id: z.string(),
    property_name: z.string(),
    unit_id: z.string(),
    unit_number: z.string(),
    lease_id: z.string(),
    lease_reference: z.string(),
    status: z.enum(ARRANGEMENT_STATUSES),
    frequency: z.enum(INSTALLMENT_FREQUENCIES),
    installment_amount: figure,
    outstanding_balance: figure,
    first_installment_date: z.string(),
    final_installment_date: z.string(),
    agreed_on: z.string(),
    closed_on: optional(z.string()),
    suppress_arrears_reminders: z.boolean(),
    installments: z.array(installmentJson),
  })
  .transform(
    (row): ReportArrangement => ({
      arrangementId: row.arrangement_id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      propertyId: row.property_id,
      propertyName: row.property_name,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      leaseId: row.lease_id,
      leaseReference: row.lease_reference,
      status: row.status,
      frequency: row.frequency,
      installmentAmount: row.installment_amount,
      outstandingBalance: row.outstanding_balance,
      firstInstallmentDate: row.first_installment_date,
      finalInstallmentDate: row.final_installment_date,
      agreedOn: row.agreed_on,
      ...(row.closed_on ? { closedOn: row.closed_on } : {}),
      suppressArrearsReminders: row.suppress_arrears_reminders,
      installments: row.installments.map((i) => ({ ...i, arrangementId: row.arrangement_id })),
    }),
  )

const settingsRow = z.object({ arrears_config: z.unknown(), arrangement_attention_config: z.unknown() })

/** The shapes of the two monitoring rule configs the reports read (as the core's monitoring settings validate them). */
const arrearsConfig = z.object({ kind: z.literal('arrears'), ageingBucketsDays: z.array(z.number().int().positive()).min(1) })
const arrangementAttentionConfig = z.object({ kind: z.literal('arrangement_attention'), graceDays: z.number().int().nonnegative() })

/** How the company ages arrears and when an instalment counts as overdue. */
export interface ArrearsSettings {
  ageingBuckets: readonly number[]
  graceDays: number
}

const logger = new Logger('ArrearsReportData')

/**
 * The rows the arrears and payment arrangements reports read, through the read-only reporting functions of
 * supabase/migrations/*_reports_arrears_arrangements.sql (caller's token, RLS; 403 for another company). The monitoring
 * configuration falls back to the defaults the core uses (ageing buckets 30/60/90/120, no grace days) when a rule is
 * missing or its config does not parse, as the core's monitoring settings do.
 */
@Injectable()
export class ArrearsReportDataService {
  constructor(private readonly data: ReportDataService) {}

  arrearsDetail(db: DbClient, companyId: EntityId): Promise<ArrearsReportAccount[]> {
    return this.data.rows(db, 'reports_arrears_detail', companyId, arrearsDetailRow, 'Read the outstanding balances')
  }

  arrangements(db: DbClient, companyId: EntityId): Promise<ReportArrangement[]> {
    return this.data.rows(db, 'reports_payment_arrangements', companyId, arrangementRow, 'Read the payment arrangements')
  }

  async settings(db: DbClient, companyId: EntityId): Promise<ArrearsSettings> {
    const [row] = await this.data.rows(db, 'reports_arrears_settings', companyId, settingsRow, 'Read the arrears monitoring settings')
    const arrears = row?.arrears_config == null ? undefined : arrearsConfig.safeParse(row.arrears_config)
    const attention = row?.arrangement_attention_config == null ? undefined : arrangementAttentionConfig.safeParse(row.arrangement_attention_config)
    if (arrears && !arrears.success) logger.warn(`The arrears monitoring rule of ${companyId} does not parse; the default buckets apply`)
    if (attention && !attention.success) logger.warn(`The arrangement monitoring rule of ${companyId} does not parse; no grace days apply`)
    return {
      ageingBuckets: arrears?.success ? arrears.data.ageingBucketsDays : DEFAULT_AGEING_BUCKETS,
      graceDays: attention?.success ? attention.data.graceDays : 0,
    }
  }
}
