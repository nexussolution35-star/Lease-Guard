import type { CompanyScoped, EntityId, ISODate, ISODateTime, StoredFile, ZAR } from './common.js'
import type { DocumentExtractionIssue } from './extraction.js'

export const STATEMENT_SOURCES = ['MRI', 'MDA', 'PropSys', 'Sage', 'other'] as const
export type StatementSource = (typeof STATEMENT_SOURCES)[number]

export const STATEMENT_STATUSES = [
  'uploaded',
  'processing',
  'review_required',
  'verified',
  'rejected',
  'duplicate',
] as const
export type StatementStatus = (typeof STATEMENT_STATUSES)[number]

export const LINE_ITEM_CATEGORIES = [
  'rental',
  'operating_costs',
  'rates_and_taxes',
  'utilities',
  'parking',
  'marketing_levy',
  'interest',
  'other_charge',
  'payment',
  'credit',
] as const
export type LineItemCategory = (typeof LINE_ITEM_CATEGORIES)[number]

export const LINE_ITEM_KINDS = ['charge', 'payment', 'credit'] as const
export type LineItemKind = (typeof LINE_ITEM_KINDS)[number]

export interface StatementLineItem {
  id: EntityId
  statementId: EntityId
  date: ISODate
  description: string
  category: LineItemCategory
  kind: LineItemKind
  /** Always positive; `kind` determines direction. */
  amount: ZAR
  /** True when the extraction confidence for this line was below threshold. */
  flagged: boolean
}

export const EXTRACTION_FIELD_NAMES = [
  'tenant_name',
  'unit_number',
  'statement_date',
  'period_start',
  'period_end',
  'rental_charged',
  'additional_charges',
  'payments_received',
  'outstanding_balance',
  'total_due',
] as const
export type ExtractionFieldName = (typeof EXTRACTION_FIELD_NAMES)[number]

export interface ExtractedField {
  name: ExtractionFieldName
  rawText: string
  value: string | number | null
  /** 0–1 */
  confidence: number
  flagged: boolean
  correctedValue?: string | number
  correctedByUserId?: EntityId
}

export const EXTRACTION_STATUSES = ['pending_review', 'confirmed', 'corrected', 'rejected'] as const
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number]

export interface StatementExtraction extends CompanyScoped {
  statementId: EntityId
  engine: string
  extractedAt: ISODateTime
  /** 0–1 overall confidence. */
  overallConfidence: number
  fields: readonly ExtractedField[]
  /** Tenant/unit matching proposed by the extractor. */
  matchedTenantId?: EntityId
  matchedUnitId?: EntityId
  /** 0–1 */
  matchConfidence: number
  status: ExtractionStatus
  reviewedByUserId?: EntityId
  reviewedAt?: ISODateTime
  reviewNotes?: string
  /** Validation issues reported by the document-processing service for this run. */
  issues?: readonly DocumentExtractionIssue[]
}

export interface Statement extends CompanyScoped {
  propertyId: EntityId
  /** Set once matched (automatically or manually). */
  tenantId?: EntityId
  unitId?: EntityId
  leaseId?: EntityId
  file: StoredFile
  sourceSystem: StatementSource
  /** Accounting-system statement number, if printed on the document. */
  statementNumber?: string
  statementDate: ISODate
  periodStart: ISODate
  periodEnd: ISODate
  status: StatementStatus
  uploadBatchId?: string
  uploadedByUserId: EntityId
  uploadedAt: ISODateTime
  extractionId?: EntityId
  /** Verified figures. Undefined until extraction is confirmed. */
  openingBalance?: ZAR
  rentalCharged?: ZAR
  additionalCharges?: ZAR
  paymentsReceived?: ZAR
  /** Closing balance = outstanding balance owed by tenant. */
  closingBalance?: ZAR
  totalDue?: ZAR
  lineItems: readonly StatementLineItem[]
  verifiedByUserId?: EntityId
  verifiedAt?: ISODateTime
  /** Set when the statement was delivered to the tenant via WhatsApp. */
  deliveredCommunicationId?: EntityId
  /** Why automatic processing could not complete; the statement then needs manual review. */
  processingError?: string
  /** If marked duplicate, the statement it duplicates. */
  duplicateOfStatementId?: EntityId
}
