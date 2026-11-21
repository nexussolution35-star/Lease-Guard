import { PORTFOLIO_IMPORT_FIELD_KEYS, PORTFOLIO_IMPORT_ROW_RESULTS, PORTFOLIO_IMPORT_TENANT_DECISIONS } from '@leaseguard/domain'
import { z } from 'zod'

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../common/http/pagination'

/** A column mapping: `{ "<field key>": "<column heading>" }`, mapped fields only. */
export const portfolioImportColumnMappingSchema = z.partialRecord(z.enum(PORTFOLIO_IMPORT_FIELD_KEYS), z.string().min(1).max(255))

/** Body of PUT /portfolio-imports/:importId/mapping. */
export const savePortfolioImportMappingBodySchema = z.strictObject({ mapping: portfolioImportColumnMappingSchema })
export type SavePortfolioImportMappingBody = z.infer<typeof savePortfolioImportMappingBodySchema>

/** Query of GET /portfolio-imports/:importId/preview. */
export const portfolioImportPreviewQuerySchema = z.object({
  result: z.enum(PORTFOLIO_IMPORT_ROW_RESULTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})
export type PortfolioImportPreviewQuery = z.infer<typeof portfolioImportPreviewQuerySchema>

/** Stored corrections of a batch row: `{ "<field key>": "<value>" }`. */
export const portfolioImportCorrectionsSchema = z.partialRecord(z.enum(PORTFOLIO_IMPORT_FIELD_KEYS), z.string().max(255))

/** Body of PATCH /portfolio-imports/:importId/rows/:rowNumber. */
export const changePortfolioImportRowBodySchema = z.strictObject({
  corrections: z.partialRecord(z.enum(PORTFOLIO_IMPORT_FIELD_KEYS), z.string().max(255).nullable()).optional(),
  skipped: z.boolean().optional(),
  link: z
    .strictObject({ propertyId: z.uuid().optional(), unitId: z.uuid().optional() })
    .nullable()
    .optional(),
  tenantMatch: z
    .strictObject({ decision: z.enum(PORTFOLIO_IMPORT_TENANT_DECISIONS), tenantId: z.uuid().optional() })
    .refine((match) => (match.decision === 'confirmed') === (match.tenantId !== undefined), {
      message: 'Confirm with the tenantId of the existing tenant; reject without one',
    })
    .nullable()
    .optional(),
})
export type ChangePortfolioImportRowBody = z.infer<typeof changePortfolioImportRowBodySchema>
