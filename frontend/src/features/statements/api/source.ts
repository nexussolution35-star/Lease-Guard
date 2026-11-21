import type {
  ProcessStatementResultDto,
  StatementSortField,
  StatementsVerificationResultDto,
  StatementVerificationResultDto,
} from '@leaseguard/api-client'
import type {
  DuplicateMatch,
  EntityId,
  ExtractionFieldName,
  Statement,
  StatementExtraction,
  StatementListItem,
  StatementSource as StatementSourceSystem,
  StatementStatus,
} from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { StatementSortField }

/**
 * What verifying a statement did (`POST /api/v1/statements/{statementId}/verify`): the verified statement, and whether
 * monitoring for its tenant was queued to run now (false when the queue was down; the daily run covers it).
 */
export type StatementVerificationResult = StatementVerificationResultDto

/**
 * What verifying several statements did (`POST /api/v1/statements/verify`): each was verified on its own, so `verified`
 * and `notVerified` (every reason per statement) can both hold entries.
 */
export type StatementsVerificationResult = StatementsVerificationResultDto

/** What queueing a statement's processing again did (`POST /api/v1/statements/{statementId}/process`). */
export type StatementProcessingRetry = ProcessStatementResultDto

/** Sort fields accepted by `GET /api/v1/statements` (generated from the backend's OpenAPI document). */
export const STATEMENT_SORT_FIELDS = ['statementDate', 'uploadedAt'] as const satisfies readonly StatementSortField[]

/** Filters accepted by `GET /api/v1/statements`, each a single optional value. */
export interface StatementListParams extends ListParams<StatementSortField> {
  status?: StatementStatus
  propertyId?: EntityId
  tenantId?: EntityId
  leaseId?: EntityId
  /** Accounting system the statement came from (MRI, MDA, …). */
  sourceSystem?: StatementSourceSystem
  /** Statements registered in one upload batch. */
  uploadBatchId?: string
}

/** One statement PDF to upload, already checked (PDF, size) and hashed by the caller. */
export interface StatementUploadInput {
  file: File
  /** SHA-256 hex digest of the file; the API recomputes it from the stored copy and refuses a mismatch. */
  sha256: string
  propertyId: EntityId
  sourceSystem: StatementSourceSystem
  uploadBatchId: string
}

/** The step a statement upload is at, for per-file progress. */
export type StatementUploadPhase = 'uploading' | 'registering'

/**
 * How a statement upload ended, other than failing (failures throw):
 * - `registered`: saved and queued for processing (`processingQueued` false when the queue was down: it can be retried
 *   from the list); `likelyDuplicate` names another statement for the same tenant and period, for the reviewer;
 * - `identical`: the identical file is already on record as `existingStatementId`; nothing was registered and the copy
 *   was not kept, so it is never processed twice.
 */
export type StatementUploadResult =
  | { outcome: 'registered'; statement: Statement; processingQueued: boolean; likelyDuplicate: DuplicateMatch | null }
  | { outcome: 'identical'; existingStatementId: EntityId; message: string }

/**
 * Where statements come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages (each row names its property, tenant and unit) and `get` resolves to null
 * when the record is not in that company.
 */
export interface StatementSource {
  list(companyId: EntityId, params: StatementListParams): Promise<Page<StatementListItem>>
  get(companyId: EntityId, id: EntityId): Promise<Statement | null>
  /** Queues processing again, also for a statement whose processing failed (writers only). */
  retryProcessing(companyId: EntityId, id: EntityId): Promise<StatementProcessingRetry>
  /** Uploads one statement PDF through a signed URL and registers it for processing (writers only). */
  upload(companyId: EntityId, input: StatementUploadInput, onPhase?: (phase: StatementUploadPhase) => void): Promise<StatementUploadResult>
  /** The latest extraction with every field (and where the review stands with it) and issue; null before extraction. */
  getExtraction(companyId: EntityId, id: EntityId): Promise<StatementExtraction | null>
  /** A five-minute link to the original statement file (any member). */
  downloadUrl(companyId: EntityId, id: EntityId): Promise<string>
  /** Enters the correct value of one extracted field (writers only); resolves to the updated extraction. */
  correctField(companyId: EntityId, id: EntityId, field: ExtractionFieldName, value: string | number): Promise<StatementExtraction>
  /** Confirms an extracted value as correct (writers only); resolves to the updated extraction. */
  confirmField(companyId: EntityId, id: EntityId, field: ExtractionFieldName): Promise<StatementExtraction>
  /**
   * Confirms that an optional field the extractor did not find (the statement number) is not on the statement
   * (writers only); nothing is filled in. Resolves to the updated extraction.
   */
  confirmNotOnStatement(companyId: EntityId, id: EntityId, field: ExtractionFieldName): Promise<StatementExtraction>
  /** Sets the statement's tenant, unit and lease together (writers only); resolves to the updated statement. */
  setMatch(companyId: EntityId, id: EntityId, match: StatementMatch): Promise<Statement>
  /** Verifies a fully reviewed, matched statement (writers); refused with every reason while anything is unresolved. */
  verify(companyId: EntityId, id: EntityId): Promise<StatementVerificationResult>
  /** Verifies several statements, each on its own (writers); resolves to which were verified and why the others were not. */
  verifyMany(companyId: EntityId, ids: readonly EntityId[]): Promise<StatementsVerificationResult>
  /** Rejects a statement under review with a reason (writers); resolves to the rejected statement. */
  reject(companyId: EntityId, id: EntityId, reason: string): Promise<Statement>
  /** Marks a statement under review as a duplicate of another statement (writers); resolves to the statement. */
  markDuplicate(companyId: EntityId, id: EntityId, duplicateOfStatementId: EntityId): Promise<Statement>
}

/**
 * A statement's tenant and unit, chosen together. Without `leaseId` the API uses the tenant's lease of the unit that
 * was in force on the statement date.
 */
export interface StatementMatch {
  tenantId: EntityId
  unitId: EntityId
  leaseId?: EntityId
}
