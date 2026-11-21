import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { REPORT_CATALOGUE } from '@leaseguard/domain'
import { CompanyScoped } from '@leaseguard/service-kit'

import { ReportCatalogueDto } from './report-catalogue.dto'

/** The report catalogue. Any member of the active company may read it. */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class CatalogueController {
  @Get()
  @ApiOperation({ operationId: 'listReports', summary: 'List the reports available to the active company' })
  @ApiOkResponse({ type: ReportCatalogueDto })
  list(): ReportCatalogueDto {
    return { reports: REPORT_CATALOGUE.map((report) => ({ ...report })) }
  }
}
