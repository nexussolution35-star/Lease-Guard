import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Statement } from '@leaseguard/domain'

import { CompanyScoped, WRITER_ROLES } from '../../common/decorators/company-scoped.decorator'
import { CurrentCompany } from '../../common/decorators/current-company.decorator'
import { UserDb } from '../../common/decorators/user-db.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CompanyContext } from '../../common/request-context'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { StatementDto } from './dto/statement.dto'
import {
  MarkStatementDuplicateDto,
  RejectStatementDto,
  StatementsVerificationResultDto,
  StatementVerificationResultDto,
  VerifyStatementsDto,
} from './dto/statement-verification.dto'
import { markStatementDuplicateBodySchema, rejectStatementBodySchema, verifyStatementsBodySchema } from './statement-verification.schemas'
import {
  StatementVerificationService,
  type StatementsVerificationResult,
  type StatementVerificationResult,
} from './statement-verification.service'

const NOT_UNDER_REVIEW = 'The statement is not under review (uploaded, processing, verified, rejected or duplicate)'

/** The outcome of a statement review: verified, rejected or a duplicate. */
@ApiTags('statements')
@Controller('statements')
export class StatementVerificationController {
  constructor(private readonly verification: StatementVerificationService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'verifyStatements',
    summary: 'Verify several statements, each on its own',
    description:
      'Verifies each statement exactly as POST /statements/{statementId}/verify does, one after another: its own checks, ' +
      'its own audit entry, its own closed review event and its own monitoring job. A statement that cannot be verified ' +
      '(not under review, a field unresolved, the match missing, not in the company) is listed in notVerified with every ' +
      'reason and never undoes the others. Answers 200 with both lists whatever the mix.',
  })
  @ApiOkResponse({ type: StatementsVerificationResultDto })
  verifyMany(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Body(new ZodValidationPipe(verifyStatementsBodySchema)) body: VerifyStatementsDto,
  ): Promise<StatementsVerificationResult> {
    return this.verification.verifyMany(db, company.companyId, body)
  }

  @Post(':statementId/verify')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'verifyStatement',
    summary: 'Verify a statement: its reviewed values become its monitoring record',
    description:
      'Allowed once every extracted field is resolved (confirmed, corrected, or found without a flag) and the tenant, ' +
      'unit and lease are set (the lease in force on the reviewed statement date). Writes the reviewed number, date, ' +
      'period and figures onto the statement (balances are monitoring records, never transactions), records the ' +
      'verifier and time, closes the extraction review and the statement\'s review event, and queues arrears and ' +
      'lease (escalation) monitoring for the tenant at once. The only way figures reach a statement. Audited.',
  })
  @ApiOkResponse({ type: StatementVerificationResultDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: NOT_UNDER_REVIEW })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'A field is unresolved, the tenant, unit or lease is missing, or the lease was not in force (every reason listed)',
  })
  verify(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
  ): Promise<StatementVerificationResult> {
    return this.verification.verify(db, company.companyId, statementId)
  }

  @Post(':statementId/reject')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'rejectStatement',
    summary: 'Reject a statement under review, with a reason',
    description:
      'The reason is kept with the statement (rejectionReason); the extraction is closed as rejected and the ' +
      'statement\'s review event resolved. A rejected statement never counts for monitoring. Audited. Returns the statement.',
  })
  @ApiOkResponse({ type: StatementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: NOT_UNDER_REVIEW })
  reject(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
    @Body(new ZodValidationPipe(rejectStatementBodySchema)) body: RejectStatementDto,
  ): Promise<Statement> {
    return this.verification.reject(db, company.companyId, statementId, body)
  }

  @Post(':statementId/mark-duplicate')
  @HttpCode(HttpStatus.OK)
  @CompanyScoped({ roles: WRITER_ROLES })
  @ApiOperation({
    operationId: 'markStatementDuplicate',
    summary: 'Mark a statement under review as a duplicate of another statement',
    description:
      'The other statement must be in the active company and not rejected or itself a duplicate. The extraction is ' +
      'closed as rejected and the statement\'s review event resolved; a duplicate never counts for monitoring. ' +
      'Audited. Returns the statement.',
  })
  @ApiOkResponse({ type: StatementDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: NOT_UNDER_REVIEW })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'The other statement is this one, not in the company, rejected or a duplicate' })
  markDuplicate(
    @UserDb() db: DbClient,
    @CurrentCompany() company: CompanyContext,
    @Param('statementId', new ParseUUIDPipe()) statementId: string,
    @Body(new ZodValidationPipe(markStatementDuplicateBodySchema)) body: MarkStatementDuplicateDto,
  ): Promise<Statement> {
    return this.verification.markDuplicate(db, company.companyId, statementId, body)
  }
}
