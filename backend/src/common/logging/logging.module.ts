import { randomUUID } from 'node:crypto'
import type { DynamicModule } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import type { Options } from 'pino-http'

import type { ApiEnv } from '../../config/env'
import { redactQuery, redactUrl } from './redact-url'

export const REQUEST_ID_HEADER = 'x-request-id'
const CALLER_REQUEST_ID = /^[\w-]{8,128}$/

/**
 * Structured JSON logging (pino) for both processes. In the API, pino-http logs every request with a
 * request id: the caller's X-Request-Id when well-formed, otherwise a new UUID, echoed in the
 * response header. Credentials are redacted: the Authorization, Cookie and apikey headers, and secret
 * query parameters such as Meta's webhook verify token in both the logged url and query (redact-url.ts).
 */
export function httpLoggerOptions(level: ApiEnv['LOG_LEVEL']): Options {
  return {
    level,
    genReqId: (req, res) => {
      const incoming = req.headers[REQUEST_ID_HEADER]
      const id = typeof incoming === 'string' && CALLER_REQUEST_ID.test(incoming) ? incoming : randomUUID()
      res.setHeader(REQUEST_ID_HEADER, id)
      return id
    },
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.apikey'],
    serializers: {
      // Receives pino's serialized request (a copy), so the live request is not changed.
      req: (req: { url?: string; query?: unknown }) => {
        req.url = redactUrl(req.url)
        if (req.query !== undefined) req.query = redactQuery(req.query)
        return req
      },
    },
    // Orchestrator probes would otherwise dominate the logs.
    autoLogging: { ignore: (req) => req.url?.startsWith('/health') === true },
  }
}

export function loggingModule(level: ApiEnv['LOG_LEVEL']): DynamicModule {
  return LoggerModule.forRoot({ pinoHttp: httpLoggerOptions(level) })
}
