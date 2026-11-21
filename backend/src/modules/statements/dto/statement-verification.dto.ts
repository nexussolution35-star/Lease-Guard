import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import {
  MAX_STATEMENTS_PER_VERIFICATION,
  type markStatementDuplicateBodySchema,
  type rejectStatementBodySchema,
  type verifyStatementsBodySchema,
} from '../statement-verification.schemas'
import type {
  StatementNotVerified,
  StatementsVerificationResult,
  StatementVerificationResult,
  StatementVerifiedInBatch,
} from '../statement-verification.service'
import { StatementDto } from './statement.dto'

export class StatementVerificationResultDto implements StatementVerificationResult {
  @ApiProperty({ type: StatementDto, description: 'The verified statement with its figures and verifier' })
  statement!: StatementDto
  @ApiProperty({
    description:
      "Whether arrears and lease monitoring for the statement's tenant was queued to run now. False when the queue was down: " +
      'the statement is verified either way and the daily monitoring run includes it.',
  })
  monitoringQueued!: boolean
}

export class RejectStatementDto {
  @ApiProperty({ minLength: 1, maxLength: 1000, description: 'Why the statement is rejected (kept with the statement)' })
  reason!: string
}
assertSchemaMatchesDto<z.infer<typeof rejectStatementBodySchema>, RejectStatementDto>(true)

export class MarkStatementDuplicateDto {
  @ApiProperty({ format: 'uuid', description: 'The statement on record that this one duplicates (not rejected or itself a duplicate)' })
  duplicateOfStatementId!: string
}
assertSchemaMatchesDto<z.infer<typeof markStatementDuplicateBodySchema>, MarkStatementDuplicateDto>(true)

export class VerifyStatementsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_STATEMENTS_PER_VERIFICATION,
    uniqueItems: true,
    description: 'The statements to verify, each once; each is verified on its own in this order',
  })
  statementIds!: string[]
}
assertSchemaMatchesDto<z.infer<typeof verifyStatementsBodySchema>, VerifyStatementsDto>(true)

export class StatementVerifiedInBatchDto implements StatementVerifiedInBatch {
  @ApiProperty({ format: 'uuid' }) statementId!: string
  @ApiPropertyOptional({ example: 'MSQ-Shop12-2026-10.pdf' }) fileName?: string
  @ApiPropertyOptional({ example: 'ST-1042' }) statementNumber?: string
  @ApiProperty({ description: "Whether monitoring for the statement's tenant was queued to run now (false: the daily run includes it)" })
  monitoringQueued!: boolean
}

export class StatementNotVerifiedDto implements StatementNotVerified {
  @ApiProperty({ format: 'uuid' }) statementId!: string
  @ApiPropertyOptional({ description: 'Absent when the statement is not in the active company', example: 'MSQ-Shop12-2026-10.pdf' })
  fileName?: string
  @ApiPropertyOptional({ example: 'ST-1042' }) statementNumber?: string
  @ApiProperty({ type: [String], description: 'Every reason the statement was not verified, as verifying it alone would answer' })
  reasons!: string[]
}

export class StatementsVerificationResultDto implements StatementsVerificationResult {
  @ApiProperty({ type: [StatementVerifiedInBatchDto], description: 'The statements verified, in the order given' })
  verified!: StatementVerifiedInBatchDto[]
  @ApiProperty({ type: [StatementNotVerifiedDto], description: 'The statements not verified, each with every reason, in the order given' })
  notVerified!: StatementNotVerifiedDto[]
}
