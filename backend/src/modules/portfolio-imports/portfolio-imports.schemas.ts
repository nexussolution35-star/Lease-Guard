import { parseGoogleSheetsLink, PORTFOLIO_IMPORT_SCOPES } from '@leaseguard/domain'
import { z } from 'zod'

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../common/http/pagination'

/** The private bucket that keeps the original portfolio files: `<company_id>/<import_id>/<file name>`. */
export const PORTFOLIO_IMPORTS_BUCKET = 'portfolio-imports'

const fileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => /\.(csv|xlsx)$/i.test(name), { message: 'must be a .csv or .xlsx file' })
const sizeBytes = z.number().int().positive()
const sheetName = z.string().trim().min(1).max(31)

/** Body of POST /portfolio-imports/upload-url. */
export const createPortfolioImportUploadUrlBodySchema = z.strictObject({ fileName, sizeBytes })
export type CreatePortfolioImportUploadUrlBody = z.infer<typeof createPortfolioImportUploadUrlBodySchema>

/** Body of POST /portfolio-imports: the uploaded file, what it adds and, for a workbook, the sheet to read. */
export const createPortfolioImportBodySchema = z
  .strictObject({
    scope: z.enum(PORTFOLIO_IMPORT_SCOPES),
    propertyId: z.uuid().optional(),
    storagePath: z.string().min(1).max(400),
    fileName,
    sizeBytes,
    sheetName: sheetName.optional(),
  })
  .refine((body) => (body.scope === 'units') === (body.propertyId !== undefined), {
    message: 'propertyId is required to import units, and only then',
    path: ['propertyId'],
  })
export type CreatePortfolioImportBody = z.infer<typeof createPortfolioImportBodySchema>

/** Body of POST /portfolio-imports/google-sheets: the sheet's link and what it adds. */
export const createPortfolioImportFromGoogleSheetBodySchema = z
  .strictObject({
    scope: z.enum(PORTFOLIO_IMPORT_SCOPES),
    propertyId: z.uuid().optional(),
    url: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((url) => parseGoogleSheetsLink(url) !== null, {
        message: 'must be a Google Sheets link (https://docs.google.com/spreadsheets/d/…)',
      }),
  })
  .refine((body) => (body.scope === 'units') === (body.propertyId !== undefined), {
    message: 'propertyId is required to import units, and only then',
    path: ['propertyId'],
  })
export type CreatePortfolioImportFromGoogleSheetBody = z.infer<typeof createPortfolioImportFromGoogleSheetBodySchema>

/** Body of POST /portfolio-imports/:importId/sheet. */
export const selectPortfolioImportSheetBodySchema = z.strictObject({ sheetName })
export type SelectPortfolioImportSheetBody = z.infer<typeof selectPortfolioImportSheetBodySchema>

/** Query of GET /portfolio-imports: the import history, newest first. */
export const portfolioImportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  scope: z.enum(PORTFOLIO_IMPORT_SCOPES).optional(),
  propertyId: z.uuid().optional(),
})
export type PortfolioImportListQuery = z.infer<typeof portfolioImportListQuerySchema>
