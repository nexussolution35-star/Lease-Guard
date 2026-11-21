import type { EntityId, ISODateTime } from './common.js'

/** Every LeaseGuard field a portfolio file column can map to, in template order. */
export const PORTFOLIO_IMPORT_FIELD_KEYS = [
  'propertyCode',
  'propertyName',
  'propertyType',
  'addressLine1',
  'addressLine2',
  'suburb',
  'city',
  'province',
  'postalCode',
  'grossLettableAreaSqm',
  'unitNumber',
  'unitType',
  'floorAreaSqm',
  'occupancyStatus',
  'tenantTradingName',
  'tenantLegalName',
  'tenantRegistrationNumber',
  'tenantAccountReference',
  'tenantBusinessType',
  'tenantContactPerson',
  'tenantEmail',
  'tenantPhone',
] as const
export type PortfolioImportFieldKey = (typeof PORTFOLIO_IMPORT_FIELD_KEYS)[number]

/** Which file column each LeaseGuard field is read from; a field that is absent is not read. */
export type PortfolioImportColumnMapping = Partial<Record<PortfolioImportFieldKey, string>>

/**
 * Where a batch's mapping came from: applied to this batch by a person, reused from the company's last file with the
 * same headings, or suggested from the headings.
 */
export const PORTFOLIO_IMPORT_MAPPING_SOURCES = ['applied', 'saved', 'suggested'] as const
export type PortfolioImportMappingSource = (typeof PORTFOLIO_IMPORT_MAPPING_SOURCES)[number]

/** One LeaseGuard field and the file column read for it. */
export interface PortfolioImportFieldMapping {
  field: PortfolioImportFieldKey
  /** The file column; absent when the field is not read from the file. */
  column?: string
  /** The column suggested from the headings, absent when none fits. */
  suggestedColumn?: string
}

/** A batch's column mapping: every field of its scope, in template order. */
export interface PortfolioImportMapping {
  importId: EntityId
  source: PortfolioImportMappingSource
  fields: PortfolioImportFieldMapping[]
  /** When the reused mapping was saved (source `saved`). */
  savedAt?: ISODateTime
}

/**
 * A row's result when checked against the database: it would add a property, unit or tenant (`new`), every record it
 * names already exists with the same values (`match`), its tenant may be an existing tenant and waits for the
 * manager to confirm or reject that (`suggested`), a record it names exists with other values (`conflict`), it cannot
 * be read or fails validation (`invalid`), an earlier row of the file names the same records (`duplicate`), or the
 * manager left it out of the import (`skipped`).
 */
export const PORTFOLIO_IMPORT_ROW_RESULTS = ['new', 'match', 'suggested', 'conflict', 'invalid', 'duplicate', 'skipped'] as const
export type PortfolioImportRowResult = (typeof PORTFOLIO_IMPORT_ROW_RESULTS)[number]

/** One value that differs: the row's value and the other one (the existing record's, or an earlier row's). */
export interface PortfolioImportConflict {
  field: PortfolioImportFieldKey
  /** The row's value as read: an enum value, a number in plain notation, or text. */
  value: string
  /** The other value, in the same form. */
  existingValue: string
  /** The earlier row of the file the other value comes from; absent when it is the existing record's. */
  otherRowNumber?: number
}

/** The existing property, unit or tenant a row was matched to. */
export interface PortfolioImportMatchedRecord {
  id: EntityId
  /** The property's name, the unit's number, or the tenant's trading name. */
  label: string
}

/**
 * What a row says about its unit's tenant (ticket I-05), when the file has tenant columns:
 * - `new`: no tenant in LeaseGuard has its registration number or account reference, and no tenant with a similar name
 *   is waiting on the manager; approving creates it (once, when several rows name the same tenant);
 * - `match`: a tenant in LeaseGuard has the same registration number or account reference, or the manager confirmed a
 *   suggested match; nothing is created and the tenant in LeaseGuard is kept as it is;
 * - `suggested`: tenants in LeaseGuard have a similar name but no identifier in common; the manager confirms one or
 *   rejects the suggestion. Similar names alone never match;
 * - `conflict`: the identifiers name two different tenants, or disagree with the tenant they found, or another row of
 *   the file names a tenant of the same name without an identifier;
 * - `invalid`: a tenant value breaks the tenant form's rules, or a value a new tenant needs is missing.
 */
export const PORTFOLIO_IMPORT_TENANT_RESULTS = ['new', 'match', 'suggested', 'conflict', 'invalid'] as const
export type PortfolioImportTenantResult = (typeof PORTFOLIO_IMPORT_TENANT_RESULTS)[number]

/**
 * How a row's tenant was matched to a tenant in LeaseGuard: an identifier in common, the manager's confirmation, or the
 * tenant an earlier approval of this import created from the row (so approving again never creates it twice).
 */
export const PORTFOLIO_IMPORT_TENANT_MATCH_SOURCES = ['registrationNumber', 'accountReference', 'confirmed', 'createdByImport'] as const
export type PortfolioImportTenantMatchSource = (typeof PORTFOLIO_IMPORT_TENANT_MATCH_SOURCES)[number]

/** Contact details a tenant record holds; one that is missing is listed in the import summary. */
export const PORTFOLIO_IMPORT_TENANT_CONTACT_DETAILS = ['contactPerson', 'email', 'phone'] as const
export type PortfolioImportTenantContactDetail = (typeof PORTFOLIO_IMPORT_TENANT_CONTACT_DETAILS)[number]

/** A tenant in LeaseGuard whose name is like the row's tenant: a possible match the manager confirms or rejects. */
export interface PortfolioImportTenantSuggestion {
  id: EntityId
  tradingName: string
  legalName: string
  registrationNumber?: string
  accountReference?: string
}

/** A row's tenant as checked against the tenants in LeaseGuard and the file's other rows. */
export interface PortfolioImportTenantCheck {
  result: PortfolioImportTenantResult
  /** Why the tenant has its result, in words for people; at least one. */
  reasons: string[]
  /** The tenant's name as the row gives it: the trading name, else the registered name. */
  name: string
  /** The tenant in LeaseGuard the row stands for (result `match`). */
  tenant?: PortfolioImportMatchedRecord
  matchedBy?: PortfolioImportTenantMatchSource
  /** Tenants with a similar name (result `suggested`, or kept for reference after a rejection). */
  suggestions: PortfolioImportTenantSuggestion[]
  /** The earlier row that names the same new tenant by its identifier: the tenant is created once, from that row. */
  sameAsRowNumber?: number
  /** Contact details the row leaves empty. A new tenant cannot be created without its contact person and phone. */
  missingContactDetails: PortfolioImportTenantContactDetail[]
}

/** A value the manager corrected: read instead of the file's cell. */
export interface PortfolioImportCorrection {
  field: PortfolioImportFieldKey
  /** The manager's value; empty when they cleared the cell. */
  value: string
  /** The file's cell under the batch's mapping; absent when it is empty or its column is not mapped. */
  fileValue?: string
}

/**
 * What the manager changed on a row of the batch (ticket I-03): values corrected, the row skipped, or the row linked to
 * an existing property or unit so nothing new is created for it. Kept on the batch row, never on the live records.
 */
export interface PortfolioImportRowResolution {
  corrections: PortfolioImportCorrection[]
  skipped: boolean
  /** The existing property the row stands for: no property is created and the file's property values are not used. */
  linkedProperty?: PortfolioImportMatchedRecord
  /** The existing unit the row stands for: no unit is created and the file's unit values are not used. */
  linkedUnit?: PortfolioImportMatchedRecord
  /** The existing tenant the manager confirmed the row's tenant is: no tenant is created and the file's tenant values are not used. */
  linkedTenant?: PortfolioImportMatchedRecord
  /** The manager rejected the suggested tenant matches: the row's tenant is created as a new tenant. */
  tenantSuggestionsRejected: boolean
  /** Who made the last change; absent when they have since left the company. */
  changedByUserId?: EntityId
  changedAt: ISODateTime
}

/**
 * A change to one row of a batch. Fields left out are unchanged. `corrections` merges by field: a value replaces the
 * file's cell (an empty string clears it), null drops the correction so the file's cell is read again.
 */
export interface PortfolioImportRowChange {
  corrections?: Partial<Record<PortfolioImportFieldKey, string | null>>
  skipped?: boolean
  /**
   * The existing property and unit the row stands for; null removes the link. A properties import links a property,
   * optionally with one of its units (a unit alone implies its property); a units import links a unit of its property.
   */
  link?: { propertyId?: EntityId; unitId?: EntityId } | null
  /**
   * The manager's decision on the row's tenant: `confirmed` with the existing tenant it is, or `rejected` (the
   * suggestions are not the row's tenant, so a new one is created); null withdraws the decision.
   */
  tenantMatch?: PortfolioImportTenantMatchDecision | null
}

export const PORTFOLIO_IMPORT_TENANT_DECISIONS = ['confirmed', 'rejected'] as const
export type PortfolioImportTenantDecision = (typeof PORTFOLIO_IMPORT_TENANT_DECISIONS)[number]

/** Confirming that a row's tenant is an existing tenant (`tenantId`, required then), or rejecting the suggested matches. */
export interface PortfolioImportTenantMatchDecision {
  decision: PortfolioImportTenantDecision
  /** The existing tenant the row's tenant is (decision `confirmed` only). */
  tenantId?: EntityId
}

/** One row of a batch as checked against the database. Nothing is written by checking. */
export interface PortfolioImportRowCheck {
  rowNumber: number
  result: PortfolioImportRowResult
  /** Why the row has its result, in words for people; at least one. */
  reasons: string[]
  /** The values read for each field: the mapped cells as in the file, or the manager's corrections (empty ones left out). */
  values: Partial<Record<PortfolioImportFieldKey, string>>
  conflicts: PortfolioImportConflict[]
  /** The existing property the row names, when it was found. */
  property?: PortfolioImportMatchedRecord
  /** The existing unit the row names, when it was found. */
  unit?: PortfolioImportMatchedRecord
  /** The earlier row that names the same records (result `duplicate`). */
  duplicateOfRowNumber?: number
  /** The row's tenant, when the file has tenant values on the row. */
  tenant?: PortfolioImportTenantCheck
  /** What the manager changed on the row, with their sign-off; absent while nobody has changed it. */
  resolution?: PortfolioImportRowResolution
}

/** How many rows of the batch have each result. */
export type PortfolioImportResultCounts = Record<PortfolioImportRowResult, number>

/** One page of a batch's checked rows, optionally narrowed to one result, with the counts for the whole batch. */
export interface PortfolioImportPreview {
  importId: EntityId
  /** Rows of the whole batch per result, whatever the filter. */
  counts: PortfolioImportResultCounts
  items: PortfolioImportRowCheck[]
  /** Rows matching the filter. */
  total: number
  page: number
  pageSize: number
}
