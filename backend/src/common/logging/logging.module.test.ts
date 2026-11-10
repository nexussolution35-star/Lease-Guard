import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { pinoHttp } from 'pino-http'
import { afterEach, describe, expect, it } from 'vitest'

import { httpLoggerOptions } from './logging.module'

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve))
  server = undefined
})

/** Serves one request through the API's pino-http options and returns every line it logged. */
async function logsOf(path: string, headers: Record<string, string> = {}): Promise<string> {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'))
      done()
    },
  })
  const logger = pinoHttp(httpLoggerOptions('info'), stream)
  server = createServer((req, res) => {
    // Express-like parsed query, as the real API has it.
    const query = Object.fromEntries(new URL(req.url ?? '/', 'http://local').searchParams)
    Object.assign(req, { originalUrl: req.url, query })
    logger(req, res)
    req.log.info('handled')
    res.end('ok')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  await (await fetch(`http://127.0.0.1:${port}${path}`, { headers })).text()
  await new Promise((resolve) => setImmediate(resolve))
  return lines.join('')
}

describe('httpLoggerOptions', () => {
  it("never writes Meta's webhook verify token to the request log", async () => {
    const logged = await logsOf('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=never-log-me&hub.challenge=1158201444')
    expect(logged).toContain('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=[Redacted]&hub.challenge=1158201444')
    expect(logged).toContain('"hub.verify_token":"[Redacted]"')
    expect(logged).not.toContain('never-log-me')
  })

  it('redacts credential headers', async () => {
    const logged = await logsOf('/api/v1/leases', { authorization: 'Bearer secret-jwt', apikey: 'secret-key' })
    expect(logged).toContain('/api/v1/leases')
    expect(logged).not.toContain('secret-jwt')
    expect(logged).not.toContain('secret-key')
  })
})
