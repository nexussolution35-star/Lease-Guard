import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  OCCUPANCY_STATUSES,
  PROPERTY_STATUSES,
  UNIT_TENANT_SOURCES,
  UNIT_TYPES,
  type OccupancyFigures,
  type OccupancyReport,
  type OccupancyStatus,
  type OccupancyUnitRow,
  type PortfolioOverviewReport,
  type PortfolioPropertyRow,
  type PropertyStatus,
  type UnitTenantSource,
  type UnitType,
} from '@leaseguard/domain'

import { ReportEnvelopeDto } from './report-common.dto'

// ------------------------------------------------------------------------------------------ portfolio overview

export class PortfolioPropertyRowDto implements PortfolioPropertyRow {
  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty({ example: 'Maponya Square' })
  propertyName!: string

  @ApiProperty({ example: 'MSQ' })
  code!: string

  @ApiProperty({
    enum: PROPERTY_STATUSES,
    enumName: 'PropertyStatus',
    description: 'An archived property is listed only while it carries a balance or open events (or when asked for); its units are not in the totals.',
  })
  status!: PropertyStatus

  @ApiProperty()
  unitCount!: number

  @ApiProperty()
  occupiedUnits!: number

  @ApiProperty()
  vacantUnits!: number

  @ApiProperty({ description: 'Occupied units over units (0–1).', example: 0.75 })
  occupancyRate!: number

  @ApiProperty()
  activeLeases!: number

  @ApiProperty({ description: 'Current monthly rental of the active leases whose terms are verified (ZAR, excl. VAT).' })
  monthlyRentalRoll!: number

  @ApiProperty({ description: 'Outstanding on the latest verified statement of each account at the property (ZAR).' })
  outstanding!: number

  @ApiProperty({ description: 'Tenants with an outstanding balance at the property.' })
  tenantsInArrears!: number

  @ApiProperty({ description: 'Monitoring events still open (new, under review, action required, in progress).' })
  openEvents!: number
}

export class PortfolioOverviewReportDto implements PortfolioOverviewReport {
  @ApiProperty({ description: 'Listed properties that are not archived.' })
  propertyCount!: number

  @ApiProperty()
  unitCount!: number

  @ApiProperty()
  occupiedUnits!: number

  @ApiProperty()
  vacantUnits!: number

  @ApiProperty({ description: '0–1' })
  occupancyRate!: number

  @ApiProperty()
  activeLeases!: number

  @ApiProperty({ description: 'Leases that have not ended whose terms are not verified yet.' })
  unverifiedLeases!: number

  @ApiProperty()
  monthlyRentalRoll!: number

  @ApiProperty()
  totalOutstanding!: number

  @ApiProperty({ description: 'Distinct tenants with an outstanding balance.' })
  tenantsInArrears!: number

  @ApiProperty()
  openEvents!: number

  @ApiProperty({ type: [PortfolioPropertyRowDto] })
  properties!: PortfolioPropertyRowDto[]
}

export class PortfolioOverviewResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['portfolio_overview'] })
  reportId!: 'portfolio_overview'

  @ApiProperty({ type: PortfolioOverviewReportDto })
  data!: PortfolioOverviewReportDto
}

// ------------------------------------------------------------------------------------------ occupancy

export class OccupancyFiguresDto implements OccupancyFigures {
  @ApiProperty()
  total!: number

  @ApiProperty()
  occupied!: number

  @ApiProperty()
  vacant!: number

  @ApiProperty()
  underOffer!: number

  @ApiProperty()
  unavailable!: number

  @ApiProperty({ description: '0–1' })
  occupancyRate!: number

  @ApiProperty()
  floorAreaSqm!: number

  @ApiProperty()
  occupiedAreaSqm!: number
}

export class OccupancyByPropertyDto extends OccupancyFiguresDto {
  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string
}

export class OccupancyByUnitTypeDto extends OccupancyFiguresDto {
  @ApiProperty({ enum: UNIT_TYPES, enumName: 'UnitType' })
  unitType!: UnitType
}

export class OccupancyUnitRowDto implements OccupancyUnitRow {
  @ApiProperty({ format: 'uuid' })
  unitId!: string

  @ApiProperty({ example: 'S01' })
  unitNumber!: string

  @ApiProperty({ enum: UNIT_TYPES, enumName: 'UnitType' })
  unitType!: UnitType

  @ApiProperty()
  floorAreaSqm!: number

  @ApiProperty({ enum: OCCUPANCY_STATUSES, enumName: 'OccupancyStatus' })
  occupancyStatus!: OccupancyStatus

  @ApiProperty({ format: 'uuid' })
  propertyId!: string

  @ApiProperty()
  propertyName!: string

  @ApiPropertyOptional({ format: 'uuid', description: "The unit's current tenant: its current lease's tenant, else its assigned tenant." })
  tenantId?: string

  @ApiPropertyOptional()
  tenantName?: string

  @ApiPropertyOptional({ enum: UNIT_TENANT_SOURCES, enumName: 'UnitTenantSource' })
  tenantSource?: UnitTenantSource

  @ApiPropertyOptional({ format: 'uuid' })
  leaseId?: string

  @ApiPropertyOptional()
  leaseReference?: string
}

export class OccupancyReportDto implements OccupancyReport {
  @ApiProperty({ type: OccupancyFiguresDto })
  totals!: OccupancyFiguresDto

  @ApiProperty({ type: [OccupancyByPropertyDto] })
  byProperty!: OccupancyByPropertyDto[]

  @ApiProperty({ type: [OccupancyByUnitTypeDto] })
  byUnitType!: OccupancyByUnitTypeDto[]

  @ApiProperty({ type: [OccupancyUnitRowDto], description: 'Every unit counted, of the properties that are not archived.' })
  units!: OccupancyUnitRowDto[]
}

export class OccupancyResponseDto extends ReportEnvelopeDto {
  @ApiProperty({ enum: ['occupancy'] })
  reportId!: 'occupancy'

  @ApiProperty({ type: OccupancyReportDto })
  data!: OccupancyReportDto
}
