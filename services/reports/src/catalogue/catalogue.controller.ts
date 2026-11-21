import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { reportCatalogueFor } from '@leaseguard/domain'
import { CompanyScoped, CurrentCompany, type CompanyContext } from '@leaseguard/service-kit'

import { ReportCatalogueDto } from './report-catalogue.dto'

/** The report catalogue. Any member of the active company may read it; it lists the reports the member's role may open. */
@ApiTags('reports')
@CompanyScoped()
@Controller('reports')
export class CatalogueController {
  @Get()
  @ApiOperation({ operationId: 'listReports', summary: 'List the reports available to the active company' })
  @ApiOkResponse({ type: ReportCatalogueDto })
  list(@CurrentCompany() company: CompanyContext): ReportCatalogueDto {
    return { reports: reportCatalogueFor(company.role).map((report) => ({ ...report })) }
  }
}
