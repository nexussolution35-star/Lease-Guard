import type { EntityId, PortfolioImport, PortfolioImportScope } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'

/** What the manager uploads: the file, what it adds and, for units, the property they are for. */
export interface PortfolioFileUpload {
  file: File
  scope: PortfolioImportScope
  /** Required when `scope` is `units`. */
  propertyId?: EntityId
}

/** A Google Sheet the manager links instead of uploading a file. */
export interface GoogleSheetImport {
  /** The sheet's link, as copied from the browser or Share > Copy link. */
  url: string
  scope: PortfolioImportScope
  /** Required when `scope` is `units`. */
  propertyId?: EntityId
}

/**
 * Where portfolio import batches come from (the LeaseGuard API). The company is explicit so a request always matches
 * the company id in its query key.
 */
/** Which batches of the import history to read, newest first. */
export interface PortfolioImportListParams {
  page: number
  pageSize: number
  scope?: PortfolioImportScope | undefined
  /** Only imports of units into this property. */
  propertyId?: EntityId | undefined
}

export interface PortfolioImportSource {
  /** The company's import history, newest first: a batch left with rows to fix is resumed from it. */
  list(companyId: EntityId, params: PortfolioImportListParams): Promise<Page<PortfolioImport>>
  /**
   * Company admins and property managers. Signs an upload, sends the file to storage and asks the API to read it into a
   * batch. Rejects with 413 over the size limit and 422 when the file cannot be accepted (the message says why).
   */
  upload(companyId: EntityId, upload: PortfolioFileUpload): Promise<PortfolioImport>
  /**
   * Company admins and property managers. The API reads the sheet (the tab in the link, or the first) and keeps what it
   * read as the batch's file. Rejects with 400 for a link that is not a Google Sheets link, 422 for a sheet that is not
   * shared with "Anyone with the link" or does not exist (the message says what to do), 413 over the size limit.
   */
  importGoogleSheet(companyId: EntityId, sheet: GoogleSheetImport): Promise<PortfolioImport>
  /** Null when the batch does not exist in that company (API 404). */
  get(companyId: EntityId, id: EntityId): Promise<PortfolioImport | null>
  /** Reads the workbook from another of its sheets. */
  selectSheet(companyId: EntityId, id: EntityId, sheetName: string): Promise<PortfolioImport>
}
