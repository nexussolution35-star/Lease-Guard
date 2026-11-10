import { describe, expect, it } from 'vitest'

import { DocumentProcessingClient, DocumentProcessingError, type FetchFn } from './document-processing.client'
import { extractionResult } from './document-processing.test-helpers'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function client(respond: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return respond()
  }
  return { calls, client: new DocumentProcessingClient({ baseUrl: 'http://docs.internal:8000', token: 'secret-token', fetch: fetchFn }) }
}

const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
const request = {
  companyId: 'c1',
  statementId: 's1',
  sourceSystem: 'MRI' as const,
  expectedTenantNames: ['Test Trading', 'Test Trading (Pty) Ltd'],
  expectedUnitNumbers: ['Shop 1'],
}

async function failureOf(promise: Promise<unknown>): Promise<DocumentProcessingError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentProcessingError)
    return error as DocumentProcessingError
  }
  throw new Error('expected a DocumentProcessingError')
}

describe('DocumentProcessingClient', () => {
  it('posts the PDF with camelCase form fields and a bearer token, and returns the validated result', async () => {
    const { client: docs, calls } = client(async () => jsonResponse(200, { ...extractionResult(), futureField: true }))
    const result = await docs.extract(pdf, 'statement.pdf', request)
    expect(result.engine).toBe('leaseguard-pdf')
    expect(result).not.toHaveProperty('futureField')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://docs.internal:8000/v1/extractions')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer secret-token' })
    const form = calls[0].init.body as FormData
    expect(form.get('companyId')).toBe('c1')
    expect(form.get('statementId')).toBe('s1')
    expect(form.get('sourceSystem')).toBe('MRI')
    expect(form.getAll('expectedTenantNames')).toEqual(['Test Trading', 'Test Trading (Pty) Ltd'])
    expect(form.getAll('expectedUnitNumbers')).toEqual(['Shop 1'])
    expect((form.get('file') as File).name).toBe('statement.pdf')
  })

  it('rejects a response that breaks the contract, permanently', async () => {
    const snakeCase = { ...extractionResult(), overall_confidence: 0.9, overallConfidence: undefined }
    const error = await failureOf(client(async () => jsonResponse(200, snakeCase)).client.extract(pdf, 's.pdf', request))
    expect(error).toMatchObject({ retryable: false, code: 'contract_violation' })
    expect(error.message).toMatch(/overallConfidence/)

    const badMoney = extractionResult({ openingBalance: '35 000,00' })
    expect(await failureOf(client(async () => jsonResponse(200, badMoney)).client.extract(pdf, 's.pdf', request))).toMatchObject({
      retryable: false,
    })
  })

  it('treats PDF and request errors (4xx) as permanent', async () => {
    const encrypted = await failureOf(
      client(async () => jsonResponse(422, { code: 'encrypted_pdf', message: 'The PDF is password protected.', errors: null })).client.extract(pdf, 's.pdf', request),
    )
    expect(encrypted).toMatchObject({ retryable: false, status: 422, code: 'encrypted_pdf' })
    expect(encrypted.message).toBe('Document processing failed with HTTP 422 (encrypted_pdf): The PDF is password protected.')
    const auth = await failureOf(
      client(async () => jsonResponse(401, { code: 'invalid_token', message: 'Invalid token', errors: null })).client.extract(pdf, 's.pdf', request),
    )
    expect(auth).toMatchObject({ retryable: false, status: 401 })
    expect(auth.message).not.toContain('secret-token')
  })

  it('treats rate limiting, server errors and network failures as transient', async () => {
    for (const status of [429, 500, 502, 503]) {
      const error = await failureOf(client(async () => new Response('<html>busy</html>', { status })).client.extract(pdf, 's.pdf', request))
      expect(error).toMatchObject({ retryable: true, status, code: 'unknown' })
    }
    const network = await failureOf(
      client(async () => {
        throw new TypeError('fetch failed')
      }).client.extract(pdf, 's.pdf', request),
    )
    expect(network).toMatchObject({ retryable: true, code: 'network_error' })
  })
})
