import { EXTRACTION_FIELD_NAMES, type Statement, type StatementExtraction } from '../types/index.js'
import { compareISODate, formatSADate, isValidISODate } from './dates.js'
import { EXTRACTION_FIELD_LABELS, fieldResolution, leaseInForceOn, resolvedFieldValue, type LeaseCandidate } from './statementReview.js'

/**
 * Whether a statement can be verified, and if not every reason why.
 *
 * Product rule: a statement's figures become its monitoring record only once a person has resolved every extracted
 * field (confirmed, corrected, or found without a flag) and set its tenant, unit and lease. Nothing is guessed: a
 * missing value must be entered. The database repeats the field and match checks when verifying
 * (public.verify_statement), so this list is what a reviewer is told, not the only guard.
 */

export interface StatementVerificationInput {
  statement: Pick<Statement, 'status' | 'tenantId' | 'unitId' | 'leaseId'>
  /** The statement's extraction; null before it was extracted. */
  extraction: Pick<StatementExtraction, 'status' | 'fields'> | null
  /** The statement's lease once set, to check it was in force on the reviewed statement date. */
  lease?: LeaseCandidate
}

/** Every reason the statement cannot be verified yet, in words for the reviewer; empty when it can. Pure. */
export function statementVerificationProblems({ statement, extraction, lease }: StatementVerificationInput): string[] {
  if (statement.status !== 'review_required') {
    return [`The statement is ${statement.status.replace('_', ' ')}; only a statement under review can be verified`]
  }
  if (extraction === null) return ['The statement has no extracted values to verify: process it again']
  if (extraction.status !== 'pending_review') return [`The extraction was already reviewed (${extraction.status})`]

  const problems: string[] = []
  for (const name of EXTRACTION_FIELD_NAMES) {
    const field = extraction.fields.find((candidate) => candidate.name === name)
    const label = EXTRACTION_FIELD_LABELS[name]
    if (!field || (field.value === null && field.correctedValue === undefined)) {
      problems.push(`${label} was not found on the statement: enter it`)
    } else if (fieldResolution(field) === 'unresolved') {
      problems.push(`${label} is flagged: confirm or correct it`)
    }
  }
  if (!statement.tenantId) problems.push('The tenant is not set')
  if (!statement.unitId) problems.push('The unit is not set')
  if (!statement.leaseId) problems.push('The lease is not set')

  const reviewedDate = (name: 'statement_date' | 'period_start' | 'period_end'): string | undefined => {
    const field = extraction.fields.find((candidate) => candidate.name === name)
    const value = field ? resolvedFieldValue(field) : undefined
    return typeof value === 'string' && isValidISODate(value) ? value : undefined
  }
  const periodStart = reviewedDate('period_start')
  const periodEnd = reviewedDate('period_end')
  if (periodStart !== undefined && periodEnd !== undefined && compareISODate(periodEnd, periodStart) < 0) {
    problems.push('The period end is before the period start')
  }
  const statementDate = reviewedDate('statement_date')
  if (lease && statementDate !== undefined && leaseInForceOn([lease], statementDate).kind !== 'found') {
    problems.push(`The lease ${lease.reference} was not in force on ${formatSADate(statementDate)}: choose the lease again`)
  }
  return problems
}
