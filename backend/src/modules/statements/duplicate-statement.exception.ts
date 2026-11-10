import { type ArgumentsHost, Catch, ConflictException, type ExceptionFilter, HttpStatus } from '@nestjs/common'
import type { DuplicateMatch } from '@leaseguard/domain'
import type { Response } from 'express'
import { STATUS_CODES } from 'node:http'

import type { LeaseGuardRequest } from '../../common/request-context'
import type { DuplicateStatementErrorBody } from './statement-uploads.types'

/** 409: the uploaded file is identical to a statement already on record. */
export class DuplicateStatementException extends ConflictException {
  constructor(readonly match: DuplicateMatch) {
    super(match.description)
  }
}

/**
 * Writes the standard error body plus `duplicate`, so clients can link to the statement already on
 * record. Applied to the statement upload routes only; every other error keeps the global filter.
 */
@Catch(DuplicateStatementException)
export class DuplicateStatementFilter implements ExceptionFilter<DuplicateStatementException> {
  catch(exception: DuplicateStatementException, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<LeaseGuardRequest>()
    const statusCode = HttpStatus.CONFLICT
    const body: DuplicateStatementErrorBody = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Conflict',
      message: exception.message,
      requestId: request.id === undefined ? null : String(request.id),
      duplicate: exception.match,
    }
    http.getResponse<Response>().status(statusCode).json(body)
  }
}
