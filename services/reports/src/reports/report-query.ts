import { BadRequestException } from '@nestjs/common'
import { appliedReportFilters, reportFilterProblems, type ReportFilters, type ReportId } from '@leaseguard/domain'
import { z } from 'zod'

/** A query parameter that may repeat (`?status=a&status=b`): Express gives one string or an array of them. */
const repeated = <T extends z.ZodType<string>>(item: T) =>
  z
    .union([item, z.array(item)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]))

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)')

/**
 * The query every report endpoint takes (`GET /api/v1/reports/{reportId}`): `propertyId` and `status` may repeat;
 * `from` and `to` bound the report's primary date. A report ignores the filters it does not offer.
 */
export const reportQuerySchema = z
  .object({
    propertyId: repeated(z.uuid({ error: 'must be a property id (UUID)' })),
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: repeated(z.string().min(1).max(64)),
  })
  .strict()

/** A validated report query (what `reportQuerySchema` produces). */
export interface ReportQuery {
  propertyId?: string[] | undefined
  from?: string | undefined
  to?: string | undefined
  status?: string[] | undefined
}

// The schema's output is a ReportQuery.
const _schemaIsAReportQuery: (query: z.output<typeof reportQuerySchema>) => ReportQuery = (query) => query
void _schemaIsAReportQuery

/**
 * The filters `report` applies for a validated query. Throws a 400 listing every problem (a status the report does
 * not offer, a range that ends before it starts).
 */
export function reportFiltersFrom(report: ReportId, query: ReportQuery): ReportFilters {
  const filters: ReportFilters = {
    ...(query.propertyId ? { propertyIds: query.propertyId } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.status ? { statuses: query.status } : {}),
  }
  const problems = reportFilterProblems(report, filters)
  if (problems.length > 0) throw new BadRequestException(problems)
  return appliedReportFilters(report, filters)
}
