import { ApiProperty } from '@nestjs/swagger'
import { REPORT_IDS, type ReportDefinition, type ReportId } from '@leaseguard/domain'

/** One report LeaseGuard offers (packages/domain REPORT_CATALOGUE). */
export class ReportDefinitionDto implements ReportDefinition {
  @ApiProperty({ enum: REPORT_IDS, enumName: 'ReportId' })
  id!: ReportId

  @ApiProperty({ example: 'Portfolio overview' })
  title!: string

  @ApiProperty({ example: 'Properties, occupancy, rental roll and outstanding balances per property.' })
  description!: string

  @ApiProperty({ description: 'Lucide icon name, resolved by the web app.', example: 'building-2' })
  icon!: string
}

export class ReportCatalogueDto {
  @ApiProperty({ type: [ReportDefinitionDto], description: 'Every report, in display order.' })
  reports!: ReportDefinitionDto[]
}
