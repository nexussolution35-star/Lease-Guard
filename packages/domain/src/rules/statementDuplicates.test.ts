import { describe, expect, it } from 'vitest'
import { makeStatement } from './__fixtures__/lease.js'
import { detectDuplicatesInBatch, findDuplicateStatement, isDuplicate } from './statementDuplicates.js'

const existing = [
  makeStatement({ id: 's1', file: { ...makeStatement().file, sha256: 'A'.repeat(64) }, statementNumber: 'ST-001' }),
  makeStatement({ id: 's2', file: { ...makeStatement().file, sha256: 'B'.repeat(64) }, statementNumber: 'ST-002', periodStart: '2026-10-01', periodEnd: '2026-10-31' }),
]

describe('findDuplicateStatement', () => {
  it('exact file hash match', () => {
    const cand = makeStatement({ id: undefined, file: { ...makeStatement().file, sha256: 'B'.repeat(64) }, tenantId: 'someone_else' })
    expect(findDuplicateStatement(cand, existing)).toMatchObject({ existingStatementId: 's2', reason: 'identical_file', confidence: 'exact' })
  })
  it('likely metadata match (tenant + period + number)', () => {
    const cand = makeStatement({ file: { ...makeStatement().file, sha256: 'C'.repeat(64) }, statementNumber: 'ST-001' })
    expect(findDuplicateStatement({ ...cand, id: 'new' }, existing)).toMatchObject({ existingStatementId: 's1', reason: 'same_tenant_period_and_number', confidence: 'likely' })
  })
  it('no match when number, period or tenant differ or tenant is unmatched', () => {
    const base = { ...makeStatement(), file: { ...makeStatement().file, sha256: 'C'.repeat(64) } }
    expect(findDuplicateStatement({ ...base, statementNumber: 'ST-999' }, existing)).toBeNull()
    expect(findDuplicateStatement({ ...base, periodEnd: '2026-09-29' }, existing)).toBeNull()
    expect(findDuplicateStatement({ ...base, tenantId: 'other' }, existing)).toBeNull()
    expect(findDuplicateStatement({ ...base, tenantId: undefined }, existing)).toBeNull()
    expect(isDuplicate({ ...base, statementNumber: 'ST-999' }, existing)).toBe(false)
  })
  it('skips itself and prefers exact over likely', () => {
    expect(findDuplicateStatement(existing[0], existing)).toBeNull()
    const both = [
      makeStatement({ id: 'likely', file: { ...makeStatement().file, sha256: 'X'.repeat(64) } }),
      makeStatement({ id: 'exact', file: { ...makeStatement().file, sha256: 'Y'.repeat(64) }, tenantId: 'other' }),
    ]
    expect(findDuplicateStatement(makeStatement({ id: 'c', file: { ...makeStatement().file, sha256: 'Y'.repeat(64) } }), both)?.existingStatementId).toBe('exact')
  })
})

describe('detectDuplicatesInBatch', () => {
  it('finds duplicates against existing and within the batch', () => {
    const file = makeStatement().file
    const batch = [
      makeStatement({ id: undefined, file: { ...file, sha256: 'N'.repeat(64) }, statementNumber: 'ST-100', tenantId: 't9' }),
      makeStatement({ id: undefined, file: { ...file, sha256: 'N'.repeat(64) }, statementNumber: 'ST-101', tenantId: 't9' }), // dup of index 0 by hash
      makeStatement({ id: undefined, file: { ...file, sha256: 'A'.repeat(64) } }), // dup of existing s1
      makeStatement({ id: 'fresh', file: { ...file, sha256: 'Z'.repeat(64) }, tenantId: 't8', statementNumber: 'ST-200' }),
    ]
    const result = detectDuplicatesInBatch(batch, existing)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ index: 1, match: { existingStatementId: 'batch:0', confidence: 'exact' } })
    expect(result[1]).toMatchObject({ index: 2, match: { existingStatementId: 's1' } })
    expect(detectDuplicatesInBatch([batch[3]])).toEqual([])
  })
})
