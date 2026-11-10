import { type ArgumentsHost, BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { AllExceptionsFilter, type ApiErrorBody } from './all-exceptions.filter'

function run(exception: unknown): { status: number; body: ApiErrorBody } {
  const sent: { status: number; body: ApiErrorBody } = { status: 0, body: {} as ApiErrorBody }
  const response = {
    status: (code: number) => {
      sent.status = code
      return { json: (body: ApiErrorBody) => (sent.body = body) }
    },
  }
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1', method: 'GET', url: '/api/v1/leases' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost
  new AllExceptionsFilter().catch(exception, host)
  return sent
}

describe('AllExceptionsFilter', () => {
  it('keeps the status and message of HTTP exceptions', () => {
    expect(run(new ForbiddenException('You do not have access to this company'))).toEqual({
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'You do not have access to this company', requestId: 'req-1' },
    })
    expect(run(new BadRequestException(['a is required', 'b is invalid'])).body.message).toEqual([
      'a is required',
      'b is invalid',
    ])
  })

  it('hides internal error details behind a generic 500 and logs them', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'))
    expect(status).toBe(500)
    expect(body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      requestId: 'req-1',
    })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'))
    logged.mockRestore()
  })
})
