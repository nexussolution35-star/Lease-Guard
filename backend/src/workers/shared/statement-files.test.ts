import { describe, expect, it } from 'vitest'

import type { WorkerEnv } from '../../config/env'
import { fakeStorageDb, type StorageCall } from '../../infrastructure/storage/storage.test-helpers'
import { clientsFor, COMPANY, OTHER_COMPANY, STATEMENT } from '../workers.test-helpers'
import { StatementFiles, StorageDownloadError } from './statement-files'

const FILE = new Blob(['%PDF-1.7'], { type: 'application/pdf' })

function files(): { store: StatementFiles; calls: StorageCall[] } {
  const { client, calls } = fakeStorageDb(() => ({ data: FILE, error: null }))
  const env = { SUPABASE_STATEMENTS_BUCKET: 'statements' } as WorkerEnv
  return { store: new StatementFiles(clientsFor(client), env), calls }
}

async function refusal(promise: Promise<unknown>): Promise<StorageDownloadError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(StorageDownloadError)
  return error as StorageDownloadError
}

describe('StatementFiles.download', () => {
  it("downloads a file of the job's company from the statements bucket", async () => {
    const { store, calls } = files()
    const path = `${COMPANY}/${STATEMENT}/oct.pdf`
    await expect(store.download(COMPANY, path)).resolves.toBe(FILE)
    expect(calls).toEqual([{ bucket: 'statements', method: 'download', args: [path] }])
  })

  it.each([
    // Passes a prefix check, but URL parsing collapses it to the other company's object.
    [`${COMPANY}/../${OTHER_COMPANY}/${STATEMENT}/oct.pdf`, 'a .. segment into another company'],
    [`${COMPANY}/${STATEMENT}/../../${OTHER_COMPANY}/${STATEMENT}/oct.pdf`, 'a deeper .. segment'],
    [`${COMPANY}/./${STATEMENT}/oct.pdf`, 'a . segment'],
    [`${COMPANY}/%2e%2e/${OTHER_COMPANY}/oct.pdf`, 'an encoded .. segment'],
    [`${COMPANY}/${STATEMENT}/..`, 'a .. file name'],
    [`${COMPANY}/${STATEMENT}/a/b.pdf`, 'an extra segment'],
    [`${COMPANY}//${STATEMENT}/oct.pdf`, 'an empty segment'],
    [`${COMPANY}/${STATEMENT}/oct.pdf?x=1`, 'a query string'],
    [`${OTHER_COMPANY}/${STATEMENT}/oct.pdf`, "another company's file"],
    [`${COMPANY}/oct.pdf`, 'too few segments'],
  ])('refuses %s (%s) without downloading, and never retries', async (path) => {
    const { store, calls } = files()
    const error = await refusal(store.download(COMPANY, path))
    expect(error.retryable).toBe(false)
    expect(calls).toEqual([])
  })

  it('marks storage failures retryable only for network errors, 408, 429 and 5xx', async () => {
    const path = `${COMPANY}/${STATEMENT}/oct.pdf`
    const download = async (status: number | undefined) => {
      const { client } = fakeStorageDb(() => ({ data: null, error: { message: 'boom', status } }))
      return refusal(new StatementFiles(clientsFor(client), { SUPABASE_STATEMENTS_BUCKET: 'statements' } as WorkerEnv).download(COMPANY, path))
    }
    expect((await download(undefined)).retryable).toBe(true)
    expect((await download(503)).retryable).toBe(true)
    expect((await download(429)).retryable).toBe(true)
    expect((await download(400)).retryable).toBe(false)
  })
})
