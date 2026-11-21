import { Injectable, InternalServerErrorException } from '@nestjs/common'
import {
  DEPOSIT_HOLDERS,
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  GUARANTEE_STATUSES,
  LEASE_STATUSES,
  type EntityId,
  type LeaseSecurityRecord,
} from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

import { ReportDataService } from './report-data.service'

/** PostgREST returns numeric columns as JSON numbers (or strings for very large values). */
const figure = z.coerce.number().refine(Number.isFinite)
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable()

const leaseSecurityRow = z
  .object({
    lease_id: z.string(),
    reference: z.string(),
    lease_status: z.enum(LEASE_STATUSES),
    verified: z.boolean(),
    tenant_id: z.string(),
    tenant_name: z.string(),
    property_id: z.string(),
    property_name: z.string(),
    unit_id: z.string(),
    unit_number: z.string(),
    commencement_date: z.string(),
    expiry_date: z.string(),
    initial_monthly_rental: figure,
    escalation_type: z.enum(ESCALATION_TYPES),
    escalation_percentage: nullable(figure),
    escalation_fixed_amount: nullable(figure),
    escalation_cpi_assumed_percentage: nullable(figure),
    escalation_cpi_margin_percentage: nullable(figure),
    escalation_frequency: z.enum(ESCALATION_FREQUENCIES),
    first_escalation_date: z.string(),
    deposit_amount: nullable(figure),
    deposit_basis_months: nullable(figure),
    deposit_held_by: nullable(z.enum(DEPOSIT_HOLDERS)),
    deposit_interest_bearing: z.boolean().nullable(),
    guarantee_bank: z.string().nullable(),
    guarantee_reference: z.string().nullable(),
    guarantee_amount: nullable(figure),
    guarantee_basis_months: nullable(figure),
    guarantee_issued_on: z.string().nullable(),
    guarantee_expires_on: z.string().nullable(),
    guarantee_status: nullable(z.enum(GUARANTEE_STATUSES)),
  })
  .transform((row): LeaseSecurityRecord => {
    // Numeric zero values (a 0% escalation) are kept; only SQL NULL is absent, as backend/src/infrastructure/database/lease-rows.ts maps them.
    const has = <T>(value: T | null): value is T => value !== null
    return {
      leaseId: row.lease_id,
      reference: row.reference,
      status: row.lease_status,
      verified: row.verified,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      propertyId: row.property_id,
      propertyName: row.property_name,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      commencementDate: row.commencement_date,
      expiryDate: row.expiry_date,
      initialMonthlyRental: row.initial_monthly_rental,
      escalation: {
        type: row.escalation_type,
        ...(has(row.escalation_percentage) ? { percentage: row.escalation_percentage } : {}),
        ...(has(row.escalation_fixed_amount) ? { fixedAmount: row.escalation_fixed_amount } : {}),
        ...(has(row.escalation_cpi_assumed_percentage) ? { cpiAssumedPercentage: row.escalation_cpi_assumed_percentage } : {}),
        ...(has(row.escalation_cpi_margin_percentage) ? { cpiMarginPercentage: row.escalation_cpi_margin_percentage } : {}),
        frequency: row.escalation_frequency,
        firstEscalationDate: row.first_escalation_date,
      },
      // The leases_deposit_complete_check constraint makes amount, holder and interest-bearing flag all present or all absent.
      ...(has(row.deposit_amount) && has(row.deposit_held_by) && has(row.deposit_interest_bearing)
        ? {
            deposit: {
              amount: row.deposit_amount,
              heldBy: row.deposit_held_by,
              interestBearing: row.deposit_interest_bearing,
              ...(has(row.deposit_basis_months) ? { basisMonths: row.deposit_basis_months } : {}),
            },
          }
        : {}),
      ...(has(row.guarantee_bank) &&
      has(row.guarantee_reference) &&
      has(row.guarantee_amount) &&
      has(row.guarantee_basis_months) &&
      has(row.guarantee_issued_on) &&
      has(row.guarantee_expires_on) &&
      has(row.guarantee_status)
        ? {
            bankGuarantee: {
              bank: row.guarantee_bank,
              referenceNumber: row.guarantee_reference,
              amount: row.guarantee_amount,
              basisMonths: row.guarantee_basis_months,
              issuedOn: row.guarantee_issued_on,
              expiresOn: row.guarantee_expires_on,
              status: row.guarantee_status,
            },
          }
        : {}),
    }
  })

/** The guarantee expiry notice days: the company's setting and its guarantee expiry rule's `noticeDays` (raw JSON). */
export interface GuaranteeNoticeSettings {
  companyNoticeDays: number[]
  /** The rule's `noticeDays` when it is a list of numbers, else null (no rule, or not a list). */
  ruleNoticeDays: number[] | null
}

const noticeDaysRow = z
  .object({
    company_notice_days: z.array(figure),
    rule_notice_days: z.unknown(),
  })
  .transform((row): GuaranteeNoticeSettings => {
    const rule = z.array(z.number()).safeParse(row.rule_notice_days)
    return { companyNoticeDays: row.company_notice_days, ruleNoticeDays: rule.success ? rule.data : null }
  })

/**
 * The company data the deposits and guarantees report reads, through `reports_lease_security` and
 * `reports_guarantee_notice_days` (supabase/migrations/*_reports_deposits_guarantees.sql) with the caller's own token.
 */
@Injectable()
export class SecurityReportDataService {
  constructor(private readonly data: ReportDataService) {}

  leaseSecurity(db: DbClient, companyId: EntityId): Promise<LeaseSecurityRecord[]> {
    return this.data.rows(db, 'reports_lease_security', companyId, leaseSecurityRow, 'Read the deposits and guarantees')
  }

  async guaranteeNoticeSettings(db: DbClient, companyId: EntityId): Promise<GuaranteeNoticeSettings> {
    const [row] = await this.data.rows(db, 'reports_guarantee_notice_days', companyId, noticeDaysRow, 'Read the guarantee notice days')
    // A member's company always has its row; without one there is nothing to work the expiry states out from.
    if (!row) throw new InternalServerErrorException('An unexpected error occurred')
    return row
  }
}
