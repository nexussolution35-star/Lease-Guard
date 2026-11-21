import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { ISODate, ReportFilters } from '@leaseguard/domain'

import type { ReportQuery } from '../report-query'

/**
 * The query every report takes. `propertyId` and `status` repeat (`?status=vacant&status=under_offer`); a report
 * ignores the filters it does not offer and refuses (400) a status it does not offer.
 */
export class ReportQueryDto implements ReportQuery {
  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Only these properties (repeat the parameter for several).' })
  propertyId?: string[]

  @ApiPropertyOptional({ format: 'date', description: 'Inclusive start of the date range on the report\'s primary date.' })
  from?: string

  @ApiPropertyOptional({ format: 'date', description: 'Inclusive end of the date range on the report\'s primary date.' })
  to?: string

  @ApiPropertyOptional({ type: [String], description: 'Only records with these statuses (repeat the parameter for several).' })
  status?: string[]
}

/** The filters a report applied, as it states them back. */
export class ReportFiltersDto implements ReportFilters {
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  propertyIds?: string[]

  @ApiPropertyOptional({ format: 'date' })
  from?: ISODate

  @ApiPropertyOptional({ format: 'date' })
  to?: ISODate

  @ApiPropertyOptional({ type: [String] })
  statuses?: string[]
}

/** What every report response carries besides its figures. */
export abstract class ReportEnvelopeDto {
  @ApiProperty({ format: 'date', description: 'The South African date the figures are as at.', example: '2026-11-21' })
  asOf!: ISODate

  @ApiProperty({ type: ReportFiltersDto })
  filters!: ReportFiltersDto
}
