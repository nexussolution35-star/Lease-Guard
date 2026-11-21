import type { EntityId, ISODateTime } from './common.js'
import type { PortfolioImportRowResult, PortfolioImportTenantContactDetail } from './portfolioImportPreview.js'
import type { StatementSource } from './statement.js'

/**
 * Row results that keep a row out of an approval until the manager fixes it: it cannot be read, a record it names
 * exists with other values, an earlier row names the same records, or its tenant's suggested match waits on the
 * manager. A `new` row is created, a `match` row is linked to the record that exists, and a `skipped` row is left out.
 */
export const PORTFOLIO_IMPORT_BLOCKED_RESULTS = ['invalid', 'conflict', 'duplicate', 'suggested'] as const satisfies readonly PortfolioImportRowResult[]
export type PortfolioImportBlockedResult = (typeof PORTFOLIO_IMPORT_BLOCKED_RESULTS)[number]

/** What a portfolio import created: a property, a unit of a property, or the tenant of a unit. */
export const PORTFOLIO_IMPORT_RECORD_TYPES = ['property', 'unit', 'tenant'] as const
export type PortfolioImportRecordType = (typeof PORTFOLIO_IMPORT_RECORD_TYPES)[number]

/** A property, unit or tenant an approved portfolio import created. */
export interface PortfolioImportCreatedRecord {
  recordType: PortfolioImportRecordType
  /** The property's id, the unit's, or the tenant's. */
  id: EntityId
  /** The property's name and code, the unit's number, or the tenant's trading name. */
  label: string
  /** The property created, or the property of the unit created (or of the tenant's unit). */
  propertyId: EntityId
  propertyName: string
  /** The unit a created tenant is the tenant of (record type `tenant`). */
  unitId?: EntityId
  unitNumber?: string
  /** The batch row the record was created from. */
  rowNumber: number
  createdAt: ISODateTime
}

/** A tenant the import would create, or has linked, without some of its contact details. */
export interface PortfolioImportMissingContactDetails {
  rowNumber: number
  /** The tenant's name as the row gives it. */
  tenantName: string
  missing: PortfolioImportTenantContactDetail[]
  /** A new tenant cannot be created without its contact person and phone: the row stays blocked until they are filled in. */
  blocksCreation: boolean
}

/** The last approval of a portfolio import: who approved it and when. */
export interface PortfolioImportApproval {
  /** Absent when the member who approved it has since left the company. */
  approvedByUserId?: EntityId
  approvedAt: ISODateTime
}

/**
 * What approving a portfolio import does now, from its rows checked against the live records: the properties and units
 * it would create, the rows linked to records that exist, the rows skipped and the rows still blocked (left out until
 * they are fixed); with the last approval and every record the import has created so far. Importing never enables or
 * sends tenant messaging, and tenants it creates start with their WhatsApp number unvalidated.
 */
export interface PortfolioImportSummary {
  importId: EntityId
  propertiesToCreate: number
  unitsToCreate: number
  /** New tenants approving creates (a tenant several rows name is counted once). */
  tenantsToCreate: number
  /** Rows whose tenant is a tenant in LeaseGuard (same registration number or account reference, or confirmed). */
  tenantsLinked: number
  /** Rows whose tenant's suggested match waits on the manager (counted among the blocked rows). */
  tenantSuggestionsToReview: number
  /** Rows with a new tenant that leave contact details empty, in row order (skipped rows left out). */
  missingContactDetails: PortfolioImportMissingContactDetails[]
  /** Rows whose records all exist (result `match`): nothing is created for them. */
  linkedRows: number
  skippedRows: number
  /** Rows left out until they are fixed (results `invalid`, `conflict`, `duplicate`, `suggested`). */
  blockedRows: number
  /** Whether approving now would create anything. */
  canApprove: boolean
  /** Whether approving needs the accounting system the new properties' statements come from. */
  needsAccountingSystem: boolean
  approval?: PortfolioImportApproval
  /** Every record the import created, in row order. */
  created: PortfolioImportCreatedRecord[]
}

/** Approving a portfolio import. */
export interface ApprovePortfolioImportInput {
  /** The accounting system the new properties' statements come from; required when the import creates properties. */
  accountingSystem?: StatementSource
}
