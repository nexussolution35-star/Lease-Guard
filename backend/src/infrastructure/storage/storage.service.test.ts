import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { StorageService } from './storage.service'
import { fakeStorageDb, testApiEnv } from './storage.test-helpers'

const PATH = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e/6f1d2c1e-0000-4000-8000-0000000000aa/oct.pdf'

describe('StorageService', () => {
  const service = new StorageService(testApiEnv({ DOCUMENT_PROCESSING_MAX_FILE_MB: '2' }))

  it('enforces DOCUMENT_PROCESSING_MAX_FILE_MB in bytes', () => {
    expect(service.maxStatementBytes).toBe(2 * 1024 * 1024)
    expect(() => service.assertStatementSize(2 * 1024 * 1024)).not.toThrow()
    expect(() => service.assertStatementSize(2 * 1024 * 1024 + 1)).toThrow(PayloadTooLargeException)
  })

  it('signs a non-overwriting upload in the requested bucket', async () => {
    const { client, calls } = fakeStorageDb(() => ({
      data: { signedUrl: 'http://storage/upload/sign/statements/x?token=t', token: 't', path: PATH },
      error: null,
    }))

    await expect(service.createSignedUploadUrl(client, 'statements', PATH)).resolves.toEqual({
      signedUrl: 'http://storage/upload/sign/statements/x?token=t',
      token: 't',
      path: PATH,
    })
    expect(calls).toEqual([{ bucket: 'statements', method: 'createSignedUploadUrl', args: [PATH, { upsert: false }] }])
  })

  it.each([
    [{ message: 'new row violates row-level security policy', status: 400, statusCode: '403' }, ForbiddenException],
    [{ message: 'The resource already exists', status: 400, statusCode: '409' }, ConflictException],
    [{ message: 'fetch failed', status: undefined, statusCode: undefined }, ServiceUnavailableException],
    [{ message: 'bad gateway', status: 502, statusCode: '502' }, ServiceUnavailableException],
    [{ message: 'odd', status: 400, statusCode: 'InvalidKey' }, InternalServerErrorException],
  ])('maps storage error %o', async (error, type) => {
    const { client } = fakeStorageDb(() => ({ data: null, error }))
    await expect(service.createSignedUploadUrl(client, 'statements', PATH)).rejects.toBeInstanceOf(type)
  })

  it('reports object size, or null when the object does not exist', async () => {
    const found = fakeStorageDb(() => ({ data: { size: 1234 }, error: null }))
    await expect(service.objectInfo(found.client, 'statements', PATH)).resolves.toEqual({ sizeBytes: 1234 })
    expect(found.calls[0]).toMatchObject({ bucket: 'statements', method: 'info', args: [PATH] })

    const missing = fakeStorageDb(() => ({ data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }))
    await expect(service.objectInfo(missing.client, 'statements', PATH)).resolves.toBeNull()
  })

  it('downloads an object through the caller client, or null when it does not exist', async () => {
    const file = new Blob(['%PDF'])
    const found = fakeStorageDb(() => ({ data: file, error: null }))
    await expect(service.download(found.client, 'statements', PATH)).resolves.toBe(file)
    expect(found.calls).toEqual([{ bucket: 'statements', method: 'download', args: [PATH] }])

    const missing = fakeStorageDb(() => ({ data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }))
    await expect(service.download(missing.client, 'statements', PATH)).resolves.toBeNull()

    const down = fakeStorageDb(() => ({ data: null, error: { message: 'fetch failed', status: undefined, statusCode: undefined } }))
    await expect(service.download(down.client, 'statements', PATH)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
