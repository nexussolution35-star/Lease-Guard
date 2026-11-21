import { z } from 'zod'

/** Why the statement is rejected: kept with the statement and shown to reviewers. */
export const rejectStatementBodySchema = z.strictObject({
  reason: z.string().trim().min(1, 'Give a reason for rejecting the statement').max(1000),
})
export type RejectStatementBody = z.infer<typeof rejectStatementBodySchema>

/** The statement on record that this one duplicates. */
export const markStatementDuplicateBodySchema = z.strictObject({
  duplicateOfStatementId: z.uuid(),
})
export type MarkStatementDuplicateBody = z.infer<typeof markStatementDuplicateBodySchema>

/** Most statements verified in one request: one list page. */
export const MAX_STATEMENTS_PER_VERIFICATION = 100

/** Statements to verify together, each on its own. */
export const verifyStatementsBodySchema = z.strictObject({
  statementIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one statement')
    .max(MAX_STATEMENTS_PER_VERIFICATION)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, 'Each statement may be given once'),
})
export type VerifyStatementsBody = z.infer<typeof verifyStatementsBodySchema>
