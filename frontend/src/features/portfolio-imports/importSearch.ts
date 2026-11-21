import { z } from 'zod'

/**
 * `/properties/import` search params: the batch once a file is accepted, and the property when units are imported
 * into one. Invalid values are dropped instead of failing the route.
 */
export const portfolioImportSearchSchema = z.object({
  importId: z.string().optional().catch(undefined),
  propertyId: z.string().optional().catch(undefined),
})
export type PortfolioImportSearch = z.infer<typeof portfolioImportSearchSchema>
