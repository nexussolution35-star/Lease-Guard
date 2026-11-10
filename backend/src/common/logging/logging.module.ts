import { randomUUID } from 'node:crypto'
import type { DynamicModule } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import type { ApiEnv } from '../../config/env'

export const REQUEST_ID_HEADER = 'x-request-id'
const CALLER_REQUEST_ID = /^[\w-]{8,128}$/

/**
 * Structured JSON logging (pino) for both processes. In the API, pino-http logs every request with a
 * request id: the caller's X-Request-Id when well-formed, otherwise a new UUID, echoed in the
 * response header. Credentials are redacted.
 */
export function loggingModule(level: ApiEnv['LOG_LEVEL']): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level,
      genReqId: (req, res) => {
        const incoming = req.headers[REQUEST_ID_HEADER]
        const id = typeof incoming === 'string' && CALLER_REQUEST_ID.test(incoming) ? incoming : randomUUID()
        res.setHeader(REQUEST_ID_HEADER, id)
        return id
      },
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.apikey'],
      // Orchestrator probes would otherwise dominate the logs.
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') === true },
    },
  })
}
