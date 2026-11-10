import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { MonitoringEvent } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  MonitoringEventDto,
  MonitoringEventListQueryDto,
  MonitoringEventPageDto,
  UpdateMonitoringEventStatusDto,
} from './dto/monitoring-event.dto'
import { monitoringEventListQuerySchema, updateMonitoringEventStatusBodySchema } from './monitoring.schemas'
import { MonitoringService } from './monitoring.service'

// CompanyScoped is applied per route (not on the class) so write routes run the company guards once.
@ApiTags('monitoring')
@Controller('monitoring/events')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({ operationId: 'listMonitoringEvents', summary: 'List monitoring events in the active company' })
  @ApiOkResponse({ type: MonitoringEventPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(monitoringEventListQuerySchema)) query: MonitoringEventListQueryDto,
  ): Promise<Page<MonitoringEvent>> {
    return this.monitoring.list(db, company.companyId, query)
  }

  @Get(':eventId')
  @CompanyScoped()
  @ApiOperation({ operationId: 'getMonitoringEvent', summary: 'Get one monitoring event' })
  @ApiOkResponse({ type: MonitoringEventDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
  ): Promise<MonitoringEvent> {
    return this.monitoring.get(db, company.companyId, eventId)
  }

  @Patch(':eventId/status')
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'updateMonitoringEventStatus',
    summary: 'Move a monitoring event to another status',
    description:
      'Moves follow the event workflow (new → under review → action required → in progress → resolved; ' +
      'any open status → dismissed). Dismissing requires a note (the reason). Who resolved or dismissed the ' +
      'event, and when, is recorded by the database from the caller, and every status change is audited.',
  })
  @ApiOkResponse({ type: MonitoringEventDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The workflow does not allow this move, or the event changed meanwhile' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The change breaks a data integrity rule' })
  updateStatus(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body(new ZodValidationPipe(updateMonitoringEventStatusBodySchema)) body: UpdateMonitoringEventStatusDto,
  ): Promise<MonitoringEvent> {
    return this.monitoring.updateStatus(db, company.companyId, eventId, body)
  }
}
