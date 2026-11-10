import type { IncomingMessage, ServerResponse } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { rawWebhookBody } from './raw-body'

function request(method: string, chunks: string[], headers: Record<string, string> = {}) {
  const stream = new PassThrough() as PassThrough & { method: string; headers: Record<string, string>; body?: unknown }
  stream.method = method
  stream.headers = headers
  queueMicrotask(() => {
    for (const chunk of chunks) stream.write(Buffer.from(chunk))
    stream.end()
  })
  return stream
}

function response() {
  return { statusCode: 200, body: '', setHeader: vi.fn(), end: vi.fn() }
}

const run = (req: ReturnType<typeof request>, res: ReturnType<typeof response>, limit?: number) =>
  new Promise<unknown>((resolve) => {
    res.end.mockImplementation((body: string) => {
      res.body = body
      resolve('ended')
    })
    rawWebhookBody(limit)(req as unknown as IncomingMessage & { body?: unknown }, res as unknown as ServerResponse, (error) => resolve(error ?? 'next'))
  })

describe('rawWebhookBody', () => {
  it('reads a POST body as the exact bytes', async () => {
    const req = request('POST', ['{"a":', ' 1}'])
    await expect(run(req, response())).resolves.toBe('next')
    expect(Buffer.isBuffer(req.body)).toBe(true)
    expect(String(req.body)).toBe('{"a": 1}')
  })

  it('leaves other methods (the GET handshake) alone', async () => {
    const req = request('GET', [])
    await expect(run(req, response())).resolves.toBe('next')
    expect(req.body).toBeUndefined()
  })

  it('answers 413 for a body over the limit, declared or streamed, and keeps nothing', async () => {
    const declared = response()
    await expect(run(request('POST', ['x'], { 'content-length': '11' }), declared, 10)).resolves.toBe('ended')
    expect(declared.statusCode).toBe(413)

    const streamed = response()
    const req = request('POST', ['123456', '789012'])
    await expect(run(req, streamed, 10)).resolves.toBe('ended')
    expect(streamed.statusCode).toBe(413)
    expect(JSON.parse(streamed.body)).toMatchObject({ statusCode: 413 })
    expect(req.body).toBeUndefined()
  })
})
