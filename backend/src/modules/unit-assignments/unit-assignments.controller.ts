import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { UnitTenantAssignmentListItem } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { CreateUnitAssignmentDto, UnitAssignmentDto, UnitAssignmentListQueryDto, UnitAssignmentPageDto } from './dto/unit-assignment.dto'
import { createUnitAssignmentBodySchema, unitAssignmentListQuerySchema } from './unit-assignments.schemas'
import { UnitAssignmentsService } from './unit-assignments.service'

// CompanyScoped is applied per route (not on the class) so the writer-only routes do not run the
// company guards twice.
@ApiTags('unit-assignments')
@Controller('unit-assignments')
export class UnitAssignmentsController {
  constructor(private readonly assignments: UnitAssignmentsService) {}

  @Get()
  @CompanyScoped()
  @ApiOperation({
    operationId: 'listUnitAssignments',
    summary: 'List tenants assigned to units in the active company',
    description: 'Current and ended assignments (history), newest first; filter by tenant, unit, property or current.',
  })
  @ApiOkResponse({ type: UnitAssignmentPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(unitAssignmentListQuerySchema)) query: UnitAssignmentListQueryDto,
  ): Promise<Page<UnitTenantAssignmentListItem>> {
    return this.assignments.list(db, company.companyId, query)
  }

  @Post()
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'assignTenantToUnit',
    summary: 'Assign a tenant to a unit without a lease (company admins and property managers)',
    description:
      'The unit becomes occupied and its current tenant is the assigned tenant until a lease is in force. A tenant may ' +
      'hold several units; a unit has one current tenant. Refused (409, naming who holds it) when the unit is let to or ' +
      'assigned to another tenant, or its property is archived; 404 for a tenant or unit of another company. Assigning ' +
      'the tenant who already holds the unit returns the current assignment. Audited on the unit. An assignment never ' +
      'drives monitoring or tenant messages.',
  })
  @ApiCreatedResponse({ type: UnitAssignmentDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The unit is let or assigned to another tenant, or its property is archived' })
  assign(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(createUnitAssignmentBodySchema)) body: CreateUnitAssignmentDto,
  ): Promise<UnitTenantAssignmentListItem> {
    return this.assignments.assign(db, company.companyId, body)
  }

  @Post(':assignmentId/end')
  @CompanyScoped({ roles: WRITER_ROLES })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'endUnitAssignment',
    summary: 'Unassign a tenant from a unit (company admins and property managers)',
    description:
      'The assignment is kept as history. The unit returns to vacant unless a lease keeps it occupied. 409 when the ' +
      'assignment has already ended or the property is archived. Audited on the unit.',
  })
  @ApiOkResponse({ type: UnitAssignmentDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already ended, or the property is archived' })
  end(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
  ): Promise<UnitTenantAssignmentListItem> {
    return this.assignments.end(db, company.companyId, assignmentId)
  }
}
