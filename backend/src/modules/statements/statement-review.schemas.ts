import { EXTRACTION_FIELD_NAMES } from '@leaseguard/domain'
import { z } from 'zod'

/** Path parameter naming one extracted field. */
export const extractionFieldNameSchema = z.enum(EXTRACTION_FIELD_NAMES)

/**
 * A reviewer's value for one field: text for names and numbers, `YYYY-MM-DD` for dates, a rand amount for money.
 * Which of those a field takes is checked by `parseFieldCorrection` (@leaseguard/domain).
 */
export const correctExtractedFieldBodySchema = z.strictObject({
  value: z.union([z.string().max(400), z.number()]),
})
export type CorrectExtractedFieldBody = z.infer<typeof correctExtractedFieldBodySchema>

/**
 * The statement's tenant and unit, set together. Without `leaseId` the lease in force on the statement date is
 * found; with it, that lease must be the tenant's lease of the unit and in force on the statement date.
 */
export const setStatementMatchBodySchema = z.strictObject({
  tenantId: z.uuid(),
  unitId: z.uuid(),
  leaseId: z.uuid().optional(),
})
export type SetStatementMatchBody = z.infer<typeof setStatementMatchBodySchema>
