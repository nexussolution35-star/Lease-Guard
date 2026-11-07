import { useMemo } from 'react'

import { roundZar } from '@leaseguard/domain'
import { nowISO } from '@/store/ids'
import type {
  EntityId,
  ExtractedField,
  ExtractionFieldName,
  ISODate,
  Statement,
  StatementExtraction,
  StatementSource,
  StoredFile,
  ZAR,
} from '@leaseguard/domain'

import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository, getCurrentUserId } from '@/services/repository'

export const statementsRepo = createRepository('statements', {
  entityType: 'statement',
  label: 'Statement',
  idPrefix: 'stm',
  searchFields: ['statementNumber', 'statementDate'],
})

export const extractionsRepo = createRepository('statementExtractions', {
  entityType: 'statement_extraction',
  label: 'Statement extraction',
  idPrefix: 'ext',
})

export const listStatements = statementsRepo.list
export const listAllStatements = statementsRepo.listAll
export const getStatement = statementsRepo.getById
export const getExtraction = extractionsRepo.getById

export interface UploadStatementInput {
  propertyId: EntityId
  file: StoredFile
  sourceSystem: StatementSource
  statementDate: ISODate
  periodStart: ISODate
  periodEnd: ISODate
  tenantId?: EntityId
  unitId?: EntityId
  leaseId?: EntityId
  statementNumber?: string
  uploadBatchId?: string
}

/** Find a statement in the active company with the same file digest (identical upload). */
export function findStatementBySha256(sha256: string): Statement | undefined {
  return statementsRepo.listAll().find((s) => s.file.sha256 === sha256)
}

/** Register an uploaded statement file. Extraction/matching happen afterwards. */
export function uploadStatement(input: UploadStatementInput): Statement {
  return statementsRepo.create(
    {
      ...input,
      status: 'uploaded',
      uploadedByUserId: getCurrentUserId(),
      uploadedAt: nowISO(),
      lineItems: [],
    },
    { action: 'upload', summary: `Statement ${input.file.fileName} uploaded` },
  )
}

/** Attach an extraction result to a statement and move it to review. */
export function attachExtraction(
  statementId: EntityId,
  extraction: Omit<Parameters<typeof extractionsRepo.create>[0], 'statementId' | 'status'>,
  reviewRequired = true,
): StatementExtraction {
  statementsRepo.require(statementId)
  const created = extractionsRepo.create({ ...extraction, statementId, status: 'pending_review' })
  statementsRepo.update(
    statementId,
    {
      extractionId: created.id,
      status: reviewRequired ? 'review_required' : 'processing',
      ...(extraction.matchedTenantId ? { tenantId: extraction.matchedTenantId } : {}),
      ...(extraction.matchedUnitId ? { unitId: extraction.matchedUnitId } : {}),
    },
    { summary: 'Extraction attached to statement' },
  )
  return created
}

/** Verified figures a reviewer can confirm or correct. */
export interface StatementFigures {
  openingBalance?: ZAR
  rentalCharged?: ZAR
  additionalCharges?: ZAR
  paymentsReceived?: ZAR
  closingBalance?: ZAR
  totalDue?: ZAR
}

export interface ConfirmExtractionInput extends StatementFigures {
  tenantId?: EntityId
  unitId?: EntityId
  leaseId?: EntityId
  statementNumber?: string
  reviewNotes?: string
}

const FIGURE_FIELD_MAP: Readonly<Partial<Record<ExtractionFieldName, keyof StatementFigures>>> = {
  rental_charged: 'rentalCharged',
  additional_charges: 'additionalCharges',
  payments_received: 'paymentsReceived',
  outstanding_balance: 'closingBalance',
  total_due: 'totalDue',
}

const FIGURE_TO_FIELD: Readonly<Partial<Record<keyof StatementFigures, ExtractionFieldName>>> = {
  rentalCharged: 'rental_charged',
  additionalCharges: 'additional_charges',
  paymentsReceived: 'payments_received',
  closingBalance: 'outstanding_balance',
  totalDue: 'total_due',
}

function numericValue(field: ExtractedField): ZAR | undefined {
  const v = field.correctedValue ?? field.value
  return typeof v === 'number' ? v : undefined
}

/** Figures implied by an extraction (corrected values win over raw values). */
export function figuresFromExtraction(extraction: StatementExtraction): StatementFigures {
  const figures: StatementFigures = {}
  for (const field of extraction.fields) {
    const key = FIGURE_FIELD_MAP[field.name]
    if (!key) continue
    const value = numericValue(field)
    if (value !== undefined) figures[key] = value
  }
  return figures
}

/**
 * Confirm the extraction for a statement. Reviewer corrections override extracted figures; the
 * resulting figures become the statement's verified figures and the statement is `verified`.
 */
export function confirmExtraction(statementId: EntityId, corrections: ConfirmExtractionInput = {}): Statement {
  const statement = statementsRepo.require(statementId)
  const extraction = statement.extractionId ? extractionsRepo.getById(statement.extractionId) : undefined
  const base = extraction ? figuresFromExtraction(extraction) : {}
  const { tenantId, unitId, leaseId, statementNumber, reviewNotes, ...figureCorrections } = corrections
  const figures: StatementFigures = { ...base }
  const correctedKeys: (keyof StatementFigures)[] = []
  for (const key of Object.keys(figureCorrections) as (keyof StatementFigures)[]) {
    const value = figureCorrections[key]
    if (value === undefined) continue
    figures[key] = value
    if (base[key] !== value) correctedKeys.push(key)
  }
  if (figures.openingBalance !== undefined && figures.closingBalance === undefined) {
    const charges = (figures.rentalCharged ?? 0) + (figures.additionalCharges ?? 0)
    figures.closingBalance = roundZar(figures.openingBalance + charges - (figures.paymentsReceived ?? 0))
  }

  const actor = getCurrentUserId()
  if (extraction) {
    const correctedFieldNames = new Set(correctedKeys.map((k) => FIGURE_TO_FIELD[k]).filter((n) => n !== undefined))
    const fields = extraction.fields.map((f) => {
      if (!correctedFieldNames.has(f.name)) return f
      const key = FIGURE_FIELD_MAP[f.name]
      const corrected = key ? figures[key] : undefined
      return corrected === undefined ? f : { ...f, correctedValue: corrected, correctedByUserId: actor }
    })
    extractionsRepo.update(
      extraction.id,
      {
        fields,
        status: correctedKeys.length > 0 ? 'corrected' : 'confirmed',
        reviewedByUserId: actor,
        reviewedAt: nowISO(),
        ...(reviewNotes !== undefined ? { reviewNotes } : {}),
      },
      { action: 'verify', summary: correctedKeys.length > 0 ? 'Extraction corrected and confirmed' : 'Extraction confirmed' },
    )
  }

  return statementsRepo.update(
    statementId,
    {
      ...figures,
      status: 'verified',
      verifiedByUserId: actor,
      verifiedAt: nowISO(),
      ...(tenantId ? { tenantId } : {}),
      ...(unitId ? { unitId } : {}),
      ...(leaseId ? { leaseId } : {}),
      ...(statementNumber !== undefined ? { statementNumber } : {}),
    },
    { action: 'verify', summary: `Statement ${statement.file.fileName} verified` },
  )
}

export function markDuplicate(statementId: EntityId, duplicateOfStatementId: EntityId): Statement {
  const original = statementsRepo.require(duplicateOfStatementId)
  return statementsRepo.update(
    statementId,
    { status: 'duplicate', duplicateOfStatementId: original.id },
    { summary: `Statement marked as duplicate of ${original.file.fileName}` },
  )
}

export function rejectStatement(statementId: EntityId, reason: string): Statement {
  const statement = statementsRepo.require(statementId)
  if (statement.extractionId) {
    const extraction = extractionsRepo.getById(statement.extractionId)
    if (extraction) {
      extractionsRepo.update(
        extraction.id,
        { status: 'rejected', reviewedByUserId: getCurrentUserId(), reviewedAt: nowISO(), reviewNotes: reason },
        { action: 'reject', summary: 'Extraction rejected' },
      )
    }
  }
  return statementsRepo.update(statementId, { status: 'rejected' }, { action: 'reject', summary: `Statement rejected: ${reason}` })
}

export function listStatementsForTenant(tenantId: EntityId): Statement[] {
  return statementsRepo
    .listAll()
    .filter((s) => s.tenantId === tenantId)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate))
}

// Hooks --------------------------------------------------------------------

export function useStatements(query?: ListQuery<Statement>): PagedResult<Statement> {
  return statementsRepo.useList(query)
}

export const useAllStatements = statementsRepo.useAll
export const useStatement = statementsRepo.useById
export const useExtraction = extractionsRepo.useById

export function useStatementsForTenant(tenantId: EntityId | undefined): Statement[] {
  const all = statementsRepo.useAll()
  return useMemo(
    () =>
      tenantId
        ? all.filter((s) => s.tenantId === tenantId).sort((a, b) => b.statementDate.localeCompare(a.statementDate))
        : [],
    [all, tenantId],
  )
}

/** Statements waiting for a human decision. */
export function useStatementsForReview(): Statement[] {
  const all = statementsRepo.useAll()
  return useMemo(() => all.filter((s) => s.status === 'review_required'), [all])
}
