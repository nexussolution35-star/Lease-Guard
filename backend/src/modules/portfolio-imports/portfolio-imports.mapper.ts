import type { PortfolioImport, PortfolioImportDelimiter, PortfolioImportFileFormat, PortfolioImportScope } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type PortfolioImportRow = Tables<'portfolio_imports'>

/** Database row → domain `PortfolioImport`. Nullable columns become absent optional fields; the storage path stays server-side. */
export function toPortfolioImport(row: PortfolioImportRow): PortfolioImport {
  return {
    id: row.id,
    companyId: row.company_id,
    // The CHECK constraints hold these columns to the domain values.
    scope: row.scope as PortfolioImportScope,
    ...(row.property_id ? { propertyId: row.property_id } : {}),
    fileName: row.file_name,
    fileFormat: row.file_format as PortfolioImportFileFormat,
    sizeBytes: row.size_bytes,
    ...(row.sheet_name !== null ? { sheetName: row.sheet_name } : {}),
    sheetNames: row.sheet_names,
    ...(row.delimiter !== null ? { delimiter: row.delimiter as PortfolioImportDelimiter } : {}),
    ...(row.google_spreadsheet_id
      ? { googleSheet: { spreadsheetId: row.google_spreadsheet_id, ...(row.google_sheet_gid ? { gid: row.google_sheet_gid } : {}) } }
      : {}),
    columns: row.columns,
    rowCount: row.row_count,
    ...(row.uploaded_by_user_id ? { uploadedByUserId: row.uploaded_by_user_id } : {}),
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
