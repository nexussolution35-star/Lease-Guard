import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * 429 with the number of seconds to wait; AllExceptionsFilter sends it as the Retry-After header (exposed to the
 * browser through CORS).
 */
export class TooManyRequestsException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS)
  }
}
