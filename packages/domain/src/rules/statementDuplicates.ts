import type { EntityId, Statement } from '../types/index.js'

export type DuplicateReason = 'identical_file' | 'same_tenant_period_and_number'

export interface DuplicateMatch {
  /** Id of the statement already on record that the candidate duplicates. */
  existingStatementId: EntityId
  reason: DuplicateReason
  /** `exact` for identical file hashes, `likely` for metadata matches. */
  confidence: 'exact' | 'likely'
  description: string
}

/** Minimal shape needed for duplicate checks; `id` optional for not-yet-saved candidates. */
export type DuplicateCandidate = Pick<Statement, 'file' | 'tenantId' | 'periodStart' | 'periodEnd' | 'statementNumber'> & {
  id?: EntityId
}

export type ExistingStatement = DuplicateCandidate & { id: EntityId }

function sameMetadata(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (!a.tenantId || !b.tenantId) return false
  return (
    a.tenantId === b.tenantId &&
    a.periodStart === b.periodStart &&
    a.periodEnd === b.periodEnd &&
    (a.statementNumber ?? '') === (b.statementNumber ?? '')
  )
}

/**
 * Find the first statement the candidate duplicates. Order of checks:
 * 1. identical file (sha256 equal) → `exact`
 * 2. same tenantId + periodStart + periodEnd + statementNumber → `likely`
 *    (both statementNumbers undefined counts as equal; an unmatched tenant never matches).
 * A record with the candidate's own id is skipped. Exact matches win over likely ones.
 */
export function findDuplicateStatement(
  candidate: DuplicateCandidate,
  existing: readonly ExistingStatement[],
): DuplicateMatch | null {
  let likely: DuplicateMatch | null = null
  for (const e of existing) {
    if (candidate.id !== undefined && e.id === candidate.id) continue
    if (e.file.sha256 === candidate.file.sha256) {
      return {
        existingStatementId: e.id,
        reason: 'identical_file',
        confidence: 'exact',
        description: `Identical file already uploaded as statement ${e.id} (SHA-256 match)`,
      }
    }
    if (!likely && sameMetadata(candidate, e)) {
      likely = {
        existingStatementId: e.id,
        reason: 'same_tenant_period_and_number',
        confidence: 'likely',
        description: `Statement for the same tenant, period ${e.periodStart} to ${e.periodEnd}${
          e.statementNumber ? ` and number ${e.statementNumber}` : ''
        } already exists as ${e.id}`,
      }
    }
  }
  return likely
}

export function isDuplicate(candidate: DuplicateCandidate, existing: readonly ExistingStatement[]): boolean {
  return findDuplicateStatement(candidate, existing) !== null
}

export interface BatchDuplicate {
  /** Index of the candidate within the batch. */
  index: number
  candidateId?: EntityId
  match: DuplicateMatch
}

/**
 * Check a batch of uploads against existing statements AND earlier items in the same batch.
 * Batch items get a synthetic id `batch:<index>` when they have none, so intra-batch matches
 * can be reported.
 */
export function detectDuplicatesInBatch(
  candidates: readonly DuplicateCandidate[],
  existing: readonly ExistingStatement[] = [],
): BatchDuplicate[] {
  const seen: ExistingStatement[] = [...existing]
  const out: BatchDuplicate[] = []
  candidates.forEach((candidate, index) => {
    const id = candidate.id ?? `batch:${index}`
    const match = findDuplicateStatement({ ...candidate, id }, seen)
    if (match) out.push({ index, candidateId: candidate.id, match })
    else seen.push({ ...candidate, id })
  })
  return out
}
