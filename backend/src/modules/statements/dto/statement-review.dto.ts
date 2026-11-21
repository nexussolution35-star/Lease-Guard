import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { correctExtractedFieldBodySchema, setStatementMatchBodySchema } from '../statement-review.schemas'
import type { StatementDownloadUrl } from '../statement-review.service'

export class StatementDownloadUrlDto implements StatementDownloadUrl {
  @ApiProperty({ description: 'Short-lived signed link to the original statement file' }) url!: string
  @ApiProperty({ example: 300 }) expiresInSeconds!: number
}

export class CorrectExtractedFieldDto {
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }],
    description:
      'Text for tenant_name, unit_number and statement_number; YYYY-MM-DD for dates; rands (ZAR, at most 2 decimals) for amounts',
    example: 37800,
  })
  value!: string | number
}
assertSchemaMatchesDto<z.infer<typeof correctExtractedFieldBodySchema>, CorrectExtractedFieldDto>(true)

export class SetStatementMatchDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string
  @ApiProperty({ format: 'uuid', description: 'A unit of the statement\'s property' }) unitId!: string
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The tenant\'s lease of the unit; omit to use the lease in force on the statement date',
  })
  leaseId?: string
}
assertSchemaMatchesDto<z.infer<typeof setStatementMatchBodySchema>, SetStatementMatchDto>(true)
