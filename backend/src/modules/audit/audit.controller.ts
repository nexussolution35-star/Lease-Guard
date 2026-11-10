import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { UserRole } from '@leaseguard/domain'

import { CompanyScoped } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import type { Page } from '../../common/http/pagination'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { AuditLogEntry } from './audit.mapper'
import { auditLogListQuerySchema } from './audit.schemas'
import { AuditService } from './audit.service'
import { AuditLogListQueryDto, AuditLogPageDto } from './dto/audit-log.dto'

/** Roles that may read the audit log; mirrors the `auditors_read` policy (property owners may not). */
export const AUDIT_READER_ROLES: readonly UserRole[] = ['company_admin', 'property_manager', 'read_only']

@ApiTags('audit')
@CompanyScoped({ roles: AUDIT_READER_ROLES })
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ operationId: 'listAuditLogs', summary: 'List audit log entries in the active company' })
  @ApiOkResponse({ type: AuditLogPageDto })
  list(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Query(new ZodValidationPipe(auditLogListQuerySchema)) query: AuditLogListQueryDto,
  ): Promise<Page<AuditLogEntry>> {
    return this.audit.list(db, company.companyId, query)
  }
}
