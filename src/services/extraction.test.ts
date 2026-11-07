import { beforeEach, describe, expect, it } from 'vitest'

import { LEASE_IDS, PROPERTY_IDS, STATEMENT_IDS, TENANT_IDS, UNIT_IDS } from '@/data'
import { useAppStore } from '@/store/appStore'

import {
  createSimulatedFile,
  EXTRACTION_FLAG_THRESHOLD,
  matchStatementFile,
  processingStepsForStatus,
  pseudoSha256,
  simulateExtraction,
  simulateProcessingSteps,
  uploadSimulatedStatement,
  uploadStatementWithDuplicateCheck,
} from '@/services/extraction'
import { getLease } from '@/services/leases'
import { getStatement, statementsRepo } from '@/services/statements'

const PDF = (name: string, size = 120_000) => ({ name, size, type: 'application/pdf' })

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('createSimulatedFile', () => {
  it('computes a stable 64-hex digest from name and size', () => {
    const a = createSimulatedFile(PDF('MSQ-2026-11-A01.pdf'))
    const b = createSimulatedFile(PDF('MSQ-2026-11-A01.pdf'))
    const c = createSimulatedFile(PDF('MSQ-2026-11-A01.pdf', 999))
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a.sha256).toBe(b.sha256)
    expect(a.sha256).not.toBe(c.sha256)
    expect(pseudoSha256('x')).toBe(pseudoSha256('x'))
  })

  it('rejects unsupported and empty files', () => {
    expect(() => createSimulatedFile({ name: 'a.docx', size: 10, type: 'application/msword' })).toThrow(/Unsupported/)
    expect(() => createSimulatedFile(PDF('a.pdf', 0))).toThrow(/empty/)
  })
})

describe('matchStatementFile', () => {
  it('infers property, unit, lease, tenant and period from the file name', () => {
    const m = matchStatementFile('MSQ-2026-11-A01-ThriftyFoods.pdf')
    expect(m.property?.id).toBe(PROPERTY_IDS.msq)
    expect(m.unit?.id).toBe(UNIT_IDS.msqA01)
    expect(m.tenant?.id).toBe(TENANT_IDS.thriftyFoods)
    expect(m.period).toBe('2026-11')
    expect(m.confidence).toBe(0.95)
  })

  it('handles unit numbers with spaces and underscores', () => {
    expect(matchStatementFile('DVC-2026-12-Shop1-FreshMart.pdf').unit?.id).toBe(UNIT_IDS.dvc01)
    expect(matchStatementFile('MSQ-A01_2026-12.pdf').period).toBe('2026-12')
  })

  it('never matches another company property', () => {
    expect(matchStatementFile('HCR-2026-11-01.pdf').property).toBeUndefined()
    expect(matchStatementFile('random.pdf').confidence).toBe(0)
  })
})

describe('upload with duplicate detection', () => {
  it('marks an identical re-upload as duplicate of the original', () => {
    const first = uploadSimulatedStatement({ file: PDF('MSQ-2026-11-A01-ThriftyFoods.pdf') })
    expect(first.duplicate).toBeNull()
    expect(first.statement.status).toBe('uploaded')
    expect(first.statement.leaseId).toBe(LEASE_IDS.msqL001)
    expect(first.periodSource).toBe('file_name')
    expect(first.statement.periodEnd).toBe('2026-11-30')

    const again = uploadSimulatedStatement({ file: PDF('MSQ-2026-11-A01-ThriftyFoods.pdf') })
    expect(again.duplicate?.reason).toBe('identical_file')
    expect(again.statement.status).toBe('duplicate')
    expect(again.statement.duplicateOfStatementId).toBe(first.statement.id)
  })

  it('detects an existing seed statement by digest', () => {
    const existing = getStatement(STATEMENT_IDS.msqThrifty202610)
    if (!existing) throw new Error('seed statement missing')
    const res = uploadStatementWithDuplicateCheck({
      propertyId: existing.propertyId,
      file: existing.file,
      sourceSystem: existing.sourceSystem,
      statementDate: existing.statementDate,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
    })
    expect(res.statement.duplicateOfStatementId).toBe(existing.id)
  })

  it('requires a property when the file name has none', () => {
    expect(() => uploadSimulatedStatement({ file: PDF('scan.pdf') })).toThrow(/property/)
    const r = uploadSimulatedStatement({ file: PDF('scan.pdf'), propertyId: PROPERTY_IDS.dvc }, '2026-11-06')
    expect(r.periodSource).toBe('upload_date')
    expect(r.statement.periodStart).toBe('2026-11-01')
  })
})

describe('simulateExtraction', () => {
  it('derives rental from the lease, never guesses other figures and requires review', () => {
    const { statement } = uploadSimulatedStatement({ file: PDF('MSQ-2026-11-A01-ThriftyFoods.pdf') })
    const ext = simulateExtraction(statement.id)
    const field = (n: string) => ext.fields.find((f) => f.name === n)
    expect(field('rental_charged')?.value).toBe(getLease(LEASE_IDS.msqL001)?.currentMonthlyRental)
    for (const n of ['additional_charges', 'payments_received', 'outstanding_balance', 'total_due']) {
      expect(field(n)?.value).toBeNull()
      expect(field(n)?.flagged).toBe(true)
    }
    for (const f of ext.fields) if (f.value !== null) expect(f.flagged).toBe(f.confidence < EXTRACTION_FLAG_THRESHOLD)
    expect(ext.matchedTenantId).toBe(TENANT_IDS.thriftyFoods)
    expect(getStatement(statement.id)?.status).toBe('review_required')
    expect(getStatement(statement.id)?.extractionId).toBe(ext.id)
  })

  it('is deterministic for the same file', () => {
    const a = uploadSimulatedStatement({ file: PDF('MSQ-2026-12-A01.pdf') })
    const extA = simulateExtraction(a.statement.id)
    useAppStore.getState().resetDemoData()
    const b = uploadSimulatedStatement({ file: PDF('MSQ-2026-12-A01.pdf') })
    const extB = simulateExtraction(b.statement.id)
    expect(extB.fields.map((f) => f.confidence)).toEqual(extA.fields.map((f) => f.confidence))
    expect(extB.overallConfidence).toBe(extA.overallConfidence)
  })

  it('flags tenant and rental when nothing can be matched', () => {
    const { statement } = uploadSimulatedStatement({ file: PDF('scan-0001.pdf'), propertyId: PROPERTY_IDS.dvc })
    const ext = simulateExtraction(statement.id)
    expect(ext.fields.find((f) => f.name === 'tenant_name')?.value).toBeNull()
    expect(ext.fields.find((f) => f.name === 'rental_charged')?.flagged).toBe(true)
    expect(ext.matchedTenantId).toBeUndefined()
  })

  it('refuses duplicate and verified statements', () => {
    uploadSimulatedStatement({ file: PDF('MSQ-2026-11-A01.pdf') })
    const dup = uploadSimulatedStatement({ file: PDF('MSQ-2026-11-A01.pdf') })
    expect(() => simulateExtraction(dup.statement.id)).toThrow(/duplicate/)
    expect(() => simulateExtraction(STATEMENT_IDS.msqThrifty202610)).toThrow(/verified/)
  })
})

describe('processing steps', () => {
  it('are ordered and reflect status', () => {
    expect(processingStepsForStatus('review_required').map((s) => s.state)).toEqual([
      'complete', 'complete', 'complete', 'complete', 'complete', 'current',
    ])
    expect(processingStepsForStatus('duplicate')[1].state).toBe('failed')
    const { statement } = uploadSimulatedStatement({ file: PDF('MSQ-2026-11-A01.pdf') })
    expect(simulateProcessingSteps(statement.id)[2].state).toBe('current')
    expect(statementsRepo.getById(statement.id)?.status).toBe('uploaded')
  })
})
