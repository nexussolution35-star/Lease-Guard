import { ApiProperty } from '@nestjs/swagger'

import type { ApiErrorBody } from '../filters/all-exceptions.filter'

/** OpenAPI description of the error body returned by AllExceptionsFilter. */
export class ApiErrorDto implements ApiErrorBody {
  @ApiProperty({ example: 403 })
  statusCode!: number

  @ApiProperty({ example: 'Forbidden', description: 'HTTP reason phrase' })
  error!: string

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description: 'Human-readable message, or one message per validation problem',
  })
  message!: string | string[]

  @ApiProperty({ type: String, nullable: true, description: 'Matches the X-Request-Id response header' })
  requestId!: string | null
}
