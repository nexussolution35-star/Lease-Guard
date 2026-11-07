import { findDuplicateStatement, type DuplicateMatch } from '@/domain/statementDuplicates'
import { endOfMonthISO } from '@/domain/dates'
import { nowISO, todayISO } from '@/store/ids'
import type {
  EntityId,
  ExtractedField,
  ExtractionFieldName,
  ISODate,
  Lease,
  Property,
  Statement,
  StatementExtraction,
  StatementSource,
  StoredFile,
  Tenant,
  Unit,
} from '@/types'

import { leasesRepo } from '@/services/leases'
import { propertiesRepo } from '@/services/properties'
import { getActiveCompanyId } from '@/services/repository'
import {
  attachExtraction,
  markDuplicate,
  statementsRepo,
  uploadStatement,
  type UploadStatementInput,
} from '@/services/statements'
import { tenantsRepo } from '@/services/tenants'
import { unitsRepo } from '@/services/units'

/**
 * FRONTEND-ONLY extraction simulation for the statement upload/review screens. No file content is
 * read and nothing leaves the browser. Values come only from the matched lease and the statement
 * metadata; any financial figure that cannot be derived is `null` and flagged — never guessed.
 */

export const SIMULATED_EXTRACTION_ENGINE = 'leaseguard-sim/1.0'
/** Fields below this confidence are flagged for review. */
export const EXTRACTION_FLAG_THRESHOLD = 0.8

// ---------------------------------------------------------------------------------- hashing

function fnv1a(input: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Stable 64-hex pseudo digest. NOT cryptographic; only for demo duplicate detection. */
export function pseudoSha256(input: string): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += fnv1a(`${i}:${input}`, i * 0x9e3779b1).toString(16).padStart(8, '0')
  return out
}

/** Deterministic 0.60–0.99 confidence for a field of a file. */
export function pseudoConfidence(sha256: string, field: string): number {
  return Math.round((0.6 + (fnv1a(`${sha256}:${field}`, 7) % 400) / 1000) * 100) / 100
}

// ---------------------------------------------------------------------------------- files

export interface BrowserFileInfo {
  name: string
  size: number
  type: string
}

const MIME_TYPES: Readonly<Record<string, StoredFile['mimeType']>> = {
  'application/pdf': 'application/pdf',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
}

/** Build a StoredFile for a browser File; the digest is a stable hash of name + size. */
export function createSimulatedFile(file: BrowserFileInfo, companyId: EntityId = getActiveCompanyId()): StoredFile {
  const mimeType = MIME_TYPES[file.type.toLowerCase()] ?? (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined)
  if (!mimeType) throw new Error(`Unsupported file type "${file.type || 'unknown'}". Upload a PDF, PNG or JPEG statement.`)
  if (file.size <= 0) throw new Error(`File ${file.name} is empty`)
  return {
    fileName: file.name,
    storagePath: `statements/${companyId}/${file.name}`,
    mimeType,
    sizeBytes: file.size,
    sha256: pseudoSha256(`${file.name}:${file.size}`),
  }
}

// ---------------------------------------------------------------------------------- matching

export interface FileNameMatch {
  property?: Property
  unit?: Unit
  lease?: Lease
  tenant?: Tenant
  /** `YYYY-MM` when the file name carries a period. */
  period?: string
  /** 0–1: 0.95 unit + lease, 0.6 unit only, 0.3 property only, 0 nothing. */
  confidence: number
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Infer property / unit / lease / tenant from a file name such as `MSQ-2026-11-R04-Kasi.pdf` or
 * `MSQ-U05_2026-11.pdf`: leading token = property code, `YYYY-MM` = period, a token equal to a
 * unit number of that property (spaces ignored, so `Shop1` matches `Shop 1`). Active company only.
 */
export function matchStatementFile(fileName: string, propertyId?: EntityId): FileNameMatch {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, '')
  const tokens = stem.split(/[-_\s.()]+/).filter(Boolean)
  const periodMatch = /(20\d{2})[-_]?(0[1-9]|1[0-2])(?!\d)/.exec(stem)
  const period = periodMatch ? `${periodMatch[1]}-${periodMatch[2]}` : undefined
  const properties = propertiesRepo.listAll()
  const property =
    (propertyId ? properties.find((p) => p.id === propertyId) : undefined) ??
    properties.find((p) => tokens[0] !== undefined && p.code.toLowerCase() === tokens[0].toLowerCase())
  if (!property) return { ...(period ? { period } : {}), confidence: 0 }

  const candidates = new Set<string>(tokens.map(normalise))
  for (let i = 0; i < tokens.length - 1; i++) candidates.add(normalise(tokens[i] + tokens[i + 1]))
  const unit = unitsRepo.listAll().find((u) => u.propertyId === property.id && candidates.has(normalise(u.unitNumber)))
  if (!unit) return { property, ...(period ? { period } : {}), confidence: 0.3 }

  const leases = leasesRepo.listAll().filter((l) => l.unitId === unit.id)
  const lease =
    (unit.currentLeaseId ? leases.find((l) => l.id === unit.currentLeaseId) : undefined) ??
    leases.find((l) => l.status === 'active' || l.status === 'expiring')
  const tenant = lease ? tenantsRepo.getById(lease.tenantId) : undefined
  return {
    property,
    unit,
    ...(lease ? { lease } : {}),
    ...(tenant ? { tenant } : {}),
    ...(period ? { period } : {}),
    confidence: lease ? 0.95 : 0.6,
  }
}

// ---------------------------------------------------------------------------------- upload

export interface UploadWithDuplicateCheckResult {
  statement: Statement
  /** Present when the upload duplicates an existing statement; the statement is then `duplicate`. */
  duplicate: DuplicateMatch | null
}

/** Register an upload, then mark it `duplicate` (with duplicateOfStatementId) when @/domain finds a match. */
export function uploadStatementWithDuplicateCheck(input: UploadStatementInput): UploadWithDuplicateCheckResult {
  const existing = statementsRepo.listAll()
  const duplicate = findDuplicateStatement(
    {
      file: input.file,
      tenantId: input.tenantId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      statementNumber: input.statementNumber,
    },
    existing,
  )
  const statement = uploadStatement(input)
  if (!duplicate) return { statement, duplicate: null }
  return { statement: markDuplicate(statement.id, duplicate.existingStatementId), duplicate }
}

export interface SimulatedUploadInput {
  file: BrowserFileInfo
  /** Required when the file name does not start with a known property code. */
  propertyId?: EntityId
  sourceSystem?: StatementSource
  uploadBatchId?: string
  /** `YYYY-MM`, used when the file name carries no period. */
  period?: string
}

export interface SimulatedUploadResult extends UploadWithDuplicateCheckResult {
  match: FileNameMatch
  /** Where the statement period came from; `upload_date` means it must be confirmed at review. */
  periodSource: 'file_name' | 'provided' | 'upload_date'
}

/** Upload a browser file: build the StoredFile, infer the match from its name, check duplicates. */
export function uploadSimulatedStatement(input: SimulatedUploadInput, today: ISODate = todayISO()): SimulatedUploadResult {
  const file = createSimulatedFile(input.file)
  const match = matchStatementFile(input.file.name, input.propertyId)
  if (!match.property) throw new Error(`Could not determine the property for ${input.file.name}; select a property first`)
  const periodSource: SimulatedUploadResult['periodSource'] = match.period ? 'file_name' : input.period ? 'provided' : 'upload_date'
  const period = match.period ?? input.period ?? today.slice(0, 7)
  const periodStart = `${period}-01`
  const result = uploadStatementWithDuplicateCheck({
    propertyId: match.property.id,
    file,
    sourceSystem: input.sourceSystem ?? match.property.accountingSystem,
    statementDate: periodStart,
    periodStart,
    periodEnd: endOfMonthISO(periodStart),
    ...(match.tenant ? { tenantId: match.tenant.id } : {}),
    ...(match.unit ? { unitId: match.unit.id } : {}),
    ...(match.lease ? { leaseId: match.lease.id } : {}),
    ...(input.uploadBatchId ? { uploadBatchId: input.uploadBatchId } : {}),
  })
  return { ...result, match, periodSource }
}

// ---------------------------------------------------------------------------------- extraction

export interface SimulateExtractionOptions {
  engine?: string
}

function field(name: ExtractionFieldName, value: string | number | null, sha256: string): ExtractedField {
  if (value === null) return { name, rawText: '', value: null, confidence: 0, flagged: true }
  const confidence = pseudoConfidence(sha256, name)
  return { name, rawText: String(value), value, confidence, flagged: confidence < EXTRACTION_FLAG_THRESHOLD }
}

/**
 * Produce a deterministic StatementExtraction for an uploaded statement and move it to
 * `review_required` (via `processing`). Only `rental_charged` is derived (from the matched lease's
 * current rental); additional charges, payments, balance and total are `null` + flagged because the
 * simulation cannot read them — a reviewer must enter them. Every simulated extraction needs review.
 */
export function simulateExtraction(statementId: EntityId, options: SimulateExtractionOptions = {}): StatementExtraction {
  const statement = statementsRepo.require(statementId)
  if (!['uploaded', 'processing', 'review_required'].includes(statement.status)) {
    throw new Error(`Statement ${statement.file.fileName} is ${statement.status} and cannot be extracted`)
  }
  statementsRepo.update(statementId, { status: 'processing' }, { summary: 'Statement extraction started' })

  const match = matchStatementFile(statement.file.fileName, statement.propertyId)
  const unit = unitsRepo.getById(statement.unitId) ?? match.unit
  const lease = leasesRepo.getById(statement.leaseId) ?? (unit && match.unit?.id === unit.id ? match.lease : undefined)
  const tenant = tenantsRepo.getById(statement.tenantId ?? lease?.tenantId)
  const sha = statement.file.sha256

  const fields: ExtractedField[] = [
    field('tenant_name', tenant?.legalName ?? null, sha),
    field('unit_number', unit?.unitNumber ?? null, sha),
    field('statement_date', statement.statementDate, sha),
    field('period_start', statement.periodStart, sha),
    field('period_end', statement.periodEnd, sha),
    field('rental_charged', lease ? lease.currentMonthlyRental : null, sha),
    field('additional_charges', null, sha),
    field('payments_received', null, sha),
    field('outstanding_balance', null, sha),
    field('total_due', null, sha),
  ]
  const extracted = fields.filter((f) => f.value !== null)
  const overallConfidence =
    extracted.length === 0 ? 0 : Math.round((extracted.reduce((s, f) => s + f.confidence, 0) / extracted.length) * 100) / 100
  const matchConfidence = tenant && unit && lease ? 0.95 : unit ? 0.6 : 0.3

  const extraction = attachExtraction(
    statementId,
    {
      engine: options.engine ?? SIMULATED_EXTRACTION_ENGINE,
      extractedAt: nowISO(),
      overallConfidence,
      fields,
      ...(tenant ? { matchedTenantId: tenant.id } : {}),
      ...(unit ? { matchedUnitId: unit.id } : {}),
      matchConfidence,
    },
    true,
  )
  if (lease && statement.leaseId !== lease.id) {
    statementsRepo.update(statementId, { leaseId: lease.id }, { summary: 'Lease proposed by extraction' })
  }
  return extraction
}

// ---------------------------------------------------------------------------------- progress

export const STATEMENT_PROCESSING_STEPS = [
  { id: 'received', label: 'File received' },
  { id: 'duplicate_check', label: 'Duplicate check' },
  { id: 'reading', label: 'Reading document' },
  { id: 'extracting', label: 'Extracting fields' },
  { id: 'matching', label: 'Matching tenant and unit' },
  { id: 'review', label: 'Property manager review' },
] as const
export type ProcessingStepId = (typeof STATEMENT_PROCESSING_STEPS)[number]['id']
export type ProcessingStepState = 'complete' | 'current' | 'pending' | 'failed' | 'skipped'

export interface ProcessingStep {
  id: ProcessingStepId
  label: string
  state: ProcessingStepState
}

/** Ordered processing steps with their state for a statement status (for the upload progress UI). */
export function processingStepsForStatus(status: Statement['status']): ProcessingStep[] {
  const ids = STATEMENT_PROCESSING_STEPS.map((s) => s.id)
  const stateFor = (index: number): ProcessingStepState => {
    switch (status) {
      case 'uploaded':
        return index < 2 ? 'complete' : index === 2 ? 'current' : 'pending'
      case 'processing':
        return index < 3 ? 'complete' : index === 3 ? 'current' : 'pending'
      case 'review_required':
        return index < ids.length - 1 ? 'complete' : 'current'
      case 'verified':
        return 'complete'
      case 'rejected':
        return index < ids.length - 1 ? 'complete' : 'failed'
      case 'duplicate':
        return index === 0 ? 'complete' : index === 1 ? 'failed' : 'skipped'
    }
  }
  return STATEMENT_PROCESSING_STEPS.map((s, i) => ({ id: s.id, label: s.label, state: stateFor(i) }))
}

export function simulateProcessingSteps(statementId: EntityId): ProcessingStep[] {
  return processingStepsForStatus(statementsRepo.require(statementId).status)
}
