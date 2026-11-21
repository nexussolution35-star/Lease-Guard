import {
  ARRANGEMENT_CLOSE_OUTCOMES,
  ARRANGEMENT_STATUSES,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_OUTCOMES,
  isValidISODate,
} from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const ARRANGEMENT_SORT_FIELDS = ['agreedOn', 'firstInstallmentDate', 'createdAt'] as const

export const arrangementListQuerySchema = listQuerySchema(ARRANGEMENT_SORT_FIELDS, {
  status: z.enum(ARRANGEMENT_STATUSES).optional(),
  leaseId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  propertyId: z.uuid().optional(),
})
export type ArrangementListQuery = z.infer<typeof arrangementListQuerySchema>

/** API sort field → database column. */
export const ARRANGEMENT_SORT_COLUMNS = {
  agreedOn: 'agreed_on',
  firstInstallmentDate: 'first_installment_date',
  createdAt: 'created_at',
} as const satisfies Record<(typeof ARRANGEMENT_SORT_FIELDS)[number], string>

// --------------------------------------------------------------------------- record, edit, close (ticket M7-03)

const isoDate = z.string().refine(isValidISODate, 'must be a calendar date (YYYY-MM-DD)')

/** Rand amount (ZAR) above zero with at most two decimals (numeric(14,2)). */
const rand = z
  .number()
  .positive('must be more than 0')
  .max(999_999_999_999.99, 'is too large')
  .refine((value) => Math.round(value * 100) / 100 === value, { message: 'must have at most two decimals' })

const text = (max: number) => z.string().trim().max(max, `must be at most ${max} characters`)

/** A new arrangement is proposed or active; it is closed or cancelled through its own routes. */
export const OPEN_ARRANGEMENT_STATUSES = ['proposed', 'active'] as const

/**
 * Body of POST /arrangements. The lease is `leaseId`, else the tenant's single lease in force at the property (and
 * unit). The final instalment date follows the schedule; when given it must agree with it.
 */
export const createArrangementBodySchema = z.strictObject({
  tenantId: z.uuid(),
  propertyId: z.uuid(),
  unitId: z.uuid().optional(),
  leaseId: z.uuid().optional(),
  outstandingBalance: rand,
  installmentAmount: rand,
  frequency: z.enum(INSTALLMENT_FREQUENCIES),
  firstInstallmentDate: isoDate,
  finalInstallmentDate: isoDate.optional(),
  status: z.enum(OPEN_ARRANGEMENT_STATUSES).optional(),
  agreedOn: isoDate.optional(),
  notes: text(4000).optional(),
})
export type CreateArrangementBody = z.infer<typeof createArrangementBodySchema>

/** Body of PATCH /arrangements/{id}: omitted fields are unchanged. Changed terms generate the schedule again. */
export const updateArrangementBodySchema = z
  .strictObject({
    outstandingBalance: rand.optional(),
    installmentAmount: rand.optional(),
    frequency: z.enum(INSTALLMENT_FREQUENCIES).optional(),
    firstInstallmentDate: isoDate.optional(),
    finalInstallmentDate: isoDate.optional(),
    agreedOn: isoDate.optional(),
    status: z.enum(OPEN_ARRANGEMENT_STATUSES).optional(),
    notes: text(4000).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Nothing to change' })
export type UpdateArrangementBody = z.infer<typeof updateArrangementBodySchema>

/** Body of POST /arrangements/{id}/close. */
export const closeArrangementBodySchema = z.strictObject({
  outcome: z.enum(ARRANGEMENT_CLOSE_OUTCOMES),
  reason: text(1000).optional(),
})
export type CloseArrangementBody = z.infer<typeof closeArrangementBodySchema>

/** Body of POST /arrangements/{id}/cancel: the reason is required. */
export const cancelArrangementBodySchema = z.strictObject({
  reason: text(1000).refine((value) => value !== '', { message: 'Give the reason for cancelling the arrangement' }),
})
export type CancelArrangementBody = z.infer<typeof cancelArrangementBodySchema>

/** Outcomes a manager records; `scheduled` clears a recorded outcome. */
export const INSTALLMENT_OUTCOME_CHOICES = [...INSTALLMENT_OUTCOMES, 'scheduled'] as const

/** Body of POST /arrangements/{id}/installments/{installmentId}/outcome. */
export const installmentOutcomeBodySchema = z.strictObject({
  outcome: z.enum(INSTALLMENT_OUTCOME_CHOICES),
  note: text(1000).optional(),
})
export type InstallmentOutcomeBody = z.infer<typeof installmentOutcomeBodySchema>
