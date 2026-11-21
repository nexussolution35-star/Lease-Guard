import { ApiError } from '@leaseguard/api-client'
import type { Statement } from '@leaseguard/domain'
import { describe, expect, it, vi } from 'vitest'

import type { StatementUploadInput, StatementUploadResult } from '../api/source'
import { runUploadBatch, statementOf, type UploadFileState } from './uploadBatch'

const pdf = (name: string, body = name) => new File([`%PDF-1.7 ${body}`], name, { type: 'application/pdf' })
/** A readable stand-in digest: the file's text, so equal content gives equal digests. */
const digest = async (bytes: ArrayBuffer) => new TextDecoder().decode(bytes)

function registered(id: string): StatementUploadResult {
  return { outcome: 'registered', statement: { id } as Statement, processingQueued: true, likelyDuplicate: null }
}

async function run(files: File[], upload: (input: StatementUploadInput) => Promise<StatementUploadResult>) {
  const states = new Map<number, UploadFileState[]>()
  await runUploadBatch({
    files,
    propertyId: 'property-1',
    sourceSystem: 'MRI',
    uploadBatchId: 'batch-1',
    digest,
    upload: (input, onPhase) => {
      onPhase('uploading')
      return upload(input)
    },
    onChange: (index, state) => states.set(index, [...(states.get(index) ?? []), state]),
  })
  const last = (index: number) => states.get(index)?.at(-1)
  return { states, last }
}

describe('runUploadBatch', () => {
  it('checks, uploads and registers every file of the batch under one batch id, with progress per file', async () => {
    const upload = vi.fn(async (input: StatementUploadInput) => registered(`st-${input.file.name}`))
    const { states, last } = await run([pdf('a.pdf'), pdf('b.pdf')], upload)

    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls.map(([input]) => [input.uploadBatchId, input.propertyId, input.sourceSystem, input.sha256])).toEqual([
      ['batch-1', 'property-1', 'MRI', '%PDF-1.7 a.pdf'],
      ['batch-1', 'property-1', 'MRI', '%PDF-1.7 b.pdf'],
    ])
    expect(states.get(0)?.map((state) => state.phase)).toEqual(['checking', 'waiting', 'uploading', 'queued'])
    expect(last(1)).toEqual({ phase: 'queued', statementId: 'st-b.pdf', processingQueued: true })
  })

  it('refuses an empty file and a file that is not a PDF before uploading anything', async () => {
    const upload = vi.fn(async () => registered('st'))
    const { last } = await run([new File([], 'empty.pdf', { type: 'application/pdf' }), new File(['PK\u0003\u0004'], 'sheet.pdf', { type: 'application/pdf' }), pdf('ok.pdf')], upload)

    expect(last(0)).toEqual({ phase: 'failed', reason: 'The file is empty.' })
    expect(last(1)).toMatchObject({ phase: 'failed', reason: expect.stringContaining('not a PDF') })
    expect(last(2)?.phase).toBe('queued')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('uploads a file chosen twice in one batch once and reports the repeat against the first copy', async () => {
    const upload = vi.fn(async (input: StatementUploadInput) => registered(`st-${input.file.name}`))
    const { last } = await run([pdf('oct.pdf', 'same'), pdf('other.pdf'), pdf('oct (1).pdf', 'same')], upload)

    expect(upload.mock.calls.map(([input]) => input.file.name)).toEqual(['oct.pdf', 'other.pdf'])
    expect(last(2)).toEqual({ phase: 'repeat', repeatsIndex: 0 })
  })

  it('settles each file on its own: a failure does not stop the others, and an identical file links to the one on record', async () => {
    const upload = vi.fn(async (input: StatementUploadInput): Promise<StatementUploadResult> => {
      if (input.file.name === 'bad.pdf') throw new ApiError(422, ['The SHA-256 of the uploaded file does not match sha256; upload the file again'], null)
      if (input.file.name === 'known.pdf') return { outcome: 'identical', existingStatementId: 'st-on-record', message: 'Identical file' }
      return registered(`st-${input.file.name}`)
    })
    const { last } = await run([pdf('bad.pdf'), pdf('known.pdf'), pdf('new.pdf')], upload)

    expect(last(0)).toEqual({ phase: 'failed', reason: 'The SHA-256 of the uploaded file does not match sha256; upload the file again.' })
    expect(last(1)).toEqual({ phase: 'identical', existingStatementId: 'st-on-record' })
    expect(statementOf(last(1)!)).toBe('st-on-record')
    expect(last(2)?.phase).toBe('queued')
  })

  it('keeps a likely duplicate registered with its warning', async () => {
    const duplicate = { existingStatementId: 'st-other', reason: 'same_tenant_period_and_number', confidence: 'likely', description: 'x' } as const
    const { last } = await run([pdf('a.pdf')], async () => ({ outcome: 'registered', statement: { id: 'st-a' } as Statement, processingQueued: true, likelyDuplicate: duplicate }))
    expect(last(0)).toEqual({ phase: 'likely_duplicate', statementId: 'st-a', processingQueued: true, duplicate })
  })

  it('sends at most `concurrency` files at once', async () => {
    let inFlight = 0
    let most = 0
    const upload = async (input: StatementUploadInput) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return registered(input.file.name)
    }
    await runUploadBatch({
      files: Array.from({ length: 7 }, (_, index) => pdf(`f${index}.pdf`)),
      propertyId: 'p',
      sourceSystem: 'Sage',
      uploadBatchId: 'b',
      digest,
      concurrency: 2,
      upload,
      onChange: () => {},
    })
    expect(most).toBe(2)
  })
})
