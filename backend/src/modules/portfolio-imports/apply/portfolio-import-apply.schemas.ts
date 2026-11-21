import { STATEMENT_SOURCES } from '@leaseguard/domain'
import { z } from 'zod'

/** Body of POST /portfolio-imports/:importId/approve. */
export const approvePortfolioImportBodySchema = z.strictObject({
  accountingSystem: z.enum(STATEMENT_SOURCES).optional(),
})
export type ApprovePortfolioImportBody = z.infer<typeof approvePortfolioImportBodySchema>
